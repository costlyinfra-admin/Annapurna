-- 0030: separate a developer's display name from their GitHub handle on build_cost.
--
-- The coding-tool CSV now carries an explicit display name and a GitHub handle:
--     developer,github_handle,tool,amount
-- Previously `developer_id` held a single string (a login, name, or email) used
-- both for PR attribution and display. We now store the two identities
-- separately. `developer_id` stays as the attribution / grouping key (the GitHub
-- handle when known), so all existing automated imports and legacy rows keep
-- working unchanged; the new columns are nullable and simply add richer display.
ALTER TABLE build_cost ADD COLUMN developer_name text; -- human display name
ALTER TABLE build_cost ADD COLUMN github_handle  text; -- GitHub handle (PR attribution)
