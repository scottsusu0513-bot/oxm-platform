# Trusted commit approval

The local change authority is deliberately split:

`Worker edits + validates -> trusted Git evidence -> Manager review -> human commit/publish approval -> trusted commit -> normal task-branch push -> open/reuse PR -> CI -> final Manager validation`

Workers never receive Git metadata write authority. Codex runs with `.git`
read-only access, and both Codex and Claude are forbidden from `git add`,
`git commit`, branch changes, pushes, merges, and GitHub writes.

After the Manager accepts the uncommitted result, the task moves from
`running` (or `qa_running` during repair) to `awaiting_approval` with phase
`commit_publish`. Nothing is staged, committed, pushed, or opened as a PR at
that point.

The existing Approval Gateway and ApprovalRepository carry a
`commit_publish` approval for the action
`commit_and_publish_task_branch_for_pr_review`. Its immutable binding is a
SHA-256 identity over sanitized structured evidence:

- task ID and planner-assigned branch;
- expected starting HEAD;
- trusted Git-observed changed paths and allowed scope;
- a content identity for every changed path: file mode plus the Git blob id
  (SHA-1 over `blob <len>\0` + the raw working-tree bytes), or `absent` for a
  deletion — never mtime or size;
- the Git metadata digest captured right after workspace preparation;
- trusted validation and acceptance evidence;
- Manager acceptance and observed risk;
- the explicit authority limits: one commit, normal push, and open/reuse PR;
  never merge or deploy. Merge + production deployment is a SEPARATE Owner
  approval (kind `deploy`, see below) that this approval can never stand in for.

The user sees those fields (paths, modes, blob ids, digests), not file
contents, prompts, diffs, stdout, logs, or secrets.
Immediately after approval, the orchestrator re-reads the held workspace's
branch, HEAD, dirty paths, content identities, and metadata digest and
compares the resulting binding with the approved binding. Drift (a changed
byte, a deletion, a rename, an added path, or a metadata change) blocks the
task terminally: it needs fresh Manager review and fresh human approval. The trusted commit layer then validates
the repository approval again before staging and retains all existing branch,
lease, HEAD, exact-path, allowed-scope, protected-branch, deterministic-message,
and non-force-push checks.

The approval is consumed by that task state transition and authorizes one
trusted commit plus its normal push and PR publication. Duplicate approval
notifications cannot create another commit. Red-risk pre-execution and
post-QA approvals remain separate and are still required in addition to this
gate.

## Byte-level drift inside the trusted commit

`commitValidatedChanges` recomputes the content identities and the metadata
digest before staging, stages only the approved paths, then requires the index
to hold exactly the approved bytes (`git ls-files --stage` must equal
`git hash-object` of each approved file, symlink blobs verbatim, deletions
absent), recomputes the identities again, and only then commits **without a
pathspec** so Git commits the verified index instead of re-reading the
working tree. After the commit it re-checks branch, HEAD advance, a clean tree,
and the exact committed path set.

## Git metadata integrity (Claude and Codex)

Codex runs with `.git` mounted read-only by its sandbox profile. Claude has no
equivalent OS-level boundary in this architecture, so both workers are also
covered by a deterministic integrity check (`workers/gitIntegrity.ts`):

- digest inputs: `config`/`config.worktree` and every file they include,
  `hooksPath`/`attributesFile`/`excludesFile`/`fsmonitor` targets, `hooks/`,
  `info/` (attributes, exclude, sparse-checkout, grafts), `HEAD`, `commondir`,
  `shallow`, `objects/info/alternates`, replace refs (loose and packed), the
  global and system Git config files, and the index's assume-unchanged /
  skip-worktree flags;
- captured once after workspace preparation (`PreparedWorkspace`) and bound
  into the worker contract; repairs inherit the same baseline;
- verified before the worker starts, after it exits (for every outcome,
  including timeout and cancel), when trusted evidence is recorded for the
  Manager, when the approval is presented and granted, and twice inside the
  trusted commit;
- any change is a security failure (`git_metadata_changed`, red, blocked, not
  repairable). Nothing is restored automatically.

A worker that moves HEAD (for example by committing) is refused the same way.

## Deploy approval (merge + production deployment)

A change task that targets production is complete only after production
verification. After CI passes on the published PR, the SAME task (same lineage,
branch and PR) waits at the deploy gate; the Owner sees the PR number, the CI
result, unverified items and that production is not updated yet, and decides
"批准部署" or "暫不部署".

- The approval kind is `deploy`; its binding is
  `deploy:<sha256 of the canonical evidence>` over task id, lineage, PR number,
  exact approved head SHA, the CI result on that head, risk, unverified items and
  the fixed scope (merge + deploy; no commit, push, force push or production
  database). It expires like every approval.
- Right before the merge the loop re-reads the PR (open, base `main`, head ==
  the approved SHA) and CI on that head; any drift voids the approval.
- The trusted delivery layer merges with `PUT pulls/<n>/merge` and
  `sha=<approved head>` (GitHub refuses a moved head), then re-reads the merge
  from GitHub. A restart during the merge never repeats it; the outcome is read
  back.
- Completion requires a Render deployment record of exactly the merge commit
  with status `live` (rollout finished), then a passing production health check
  (`/api/health`, `/api/health/ready`) and smoke test (`/`). A deployment that
  is still rolling out, failed, on another SHA, unobservable or failing checks is
  never "complete".
- "暫不部署" (or declining publication) closes the task as
  `closed_without_deploy`, never `complete`.
- Execution requires `OXM_AGENT_OWNER_APPROVED_DEPLOY=enabled`; verification
  requires `RENDER_API_KEY` + `RENDER_SERVICE_ID` (trusted control plane only;
  never in a Worker environment, Manager prompt, repository or log).
