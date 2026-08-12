-- Add decision-maker participation field to government subsidy applications.
--
-- Records whether the applicant can arrange for the company owner or a
-- decision-making manager to join consultant discussions, so consultants
-- know before reaching out whether they can talk directly to someone with
-- decision authority instead of relaying everything through a contact
-- window (which was slowing case progress down).
--
-- Column is nullable to preserve compatibility with existing applications:
-- legacy rows (created before this field existed) must display as "未填寫"
-- (not answered), NOT be auto-interpreted as "unavailable" — those are two
-- different meanings. Stored values are stable English codes (owner /
-- manager / unavailable), not full Chinese sentences.
ALTER TABLE `upgradeApplications`
  ADD COLUMN `decisionMakerParticipation` varchar(20) NULL AFTER `email`;
