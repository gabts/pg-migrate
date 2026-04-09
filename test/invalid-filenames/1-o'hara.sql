-- % up-migration % --
INSERT INTO person (name)
VALUES ('o''hara');

-- % down-migration % --
DELETE FROM person
WHERE name = 'o''hara';
