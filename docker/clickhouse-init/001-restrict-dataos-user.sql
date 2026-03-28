-- Restrict the `dataos` application user to INSERT + SELECT only.
-- ALTER TABLE (UPDATE/DELETE mutations) require the `default` admin user.
-- Mounted via docker-compose volumes → /docker-entrypoint-initdb.d/

REVOKE ALL ON *.* FROM dataos;
GRANT SELECT, INSERT ON electroos_events.* TO dataos;
