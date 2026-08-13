-- Admin factory operations: delist (hide an approved factory from the public
-- site without deleting it) and a lightweight internal CRM layer (contact
-- status + note) for admins tracking outbound sales calls to factories.
--
-- "delisted" is a new `status` value, not a separate visibility flag: every
-- public-facing / business query in the codebase already gates on
-- `status = 'approved'` exclusively (search, factory.getById, sitemap,
-- ogMeta, review/order eligibility, etc.), so adding this value is enough to
-- hide a factory everywhere without touching each of those call sites.
ALTER TABLE `factories` MODIFY COLUMN `status` enum('draft','pending','approved','rejected','delisted') NOT NULL DEFAULT 'draft';

-- contactStatus / adminNote: admin-only CRM fields, never exposed to any
-- public API, SSR/prerender, or the factory owner/co-managers (stripped in
-- shared/badges.ts stripCertificationEvidence, the single choke point every
-- public-facing factory read already passes through). Existing rows get the
-- DEFAULT 'not_called' automatically — no backfill needed.
--
-- deletedAt: soft-delete marker for "刪除工廠". factories is referenced by
-- many business-critical tables (financeApplications, certificationCases,
-- shortVideoCases, erpCases — government subsidy / consulting case records;
-- collaborationOrders — buyer transaction history; reviews, favorites,
-- factoryRevisions, factoryCoManagers, communityBids/communityPosts author
-- links, etc.). A hard DELETE would either orphan those rows or cascade-wipe
-- records that must be retained for audit purposes, so deletion is soft:
-- the row stays, deletedAt is stamped, and status is forced to 'delisted'
-- (application-level, see db.adminSoftDeleteFactory) so it is hidden
-- everywhere the existing status='approved' checks already guard.
ALTER TABLE `factories`
  ADD COLUMN `contactStatus` enum('not_called','not_interested','follow_up') NOT NULL DEFAULT 'not_called' AFTER `rejectionReason`,
  ADD COLUMN `adminNote` text NULL AFTER `contactStatus`,
  ADD COLUMN `deletedAt` timestamp NULL AFTER `adminNote`;
