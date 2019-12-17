-- up-migration
INSERT INTO person (name)
  VALUES ('gabriel'), ('david'), ('frasse');

-- down-migration
DELETE FROM person
WHERE name IN ('gabriel', 'david', 'frasse');
