# Tree view command fixtures

One extension for each source type that the tree view commands handle: `registry`, `github`, `url` and `local`.
A fifth extension is a GitHub source that is pinned to a commit.
`src/test/suite/extensionsInstalled.test.ts` reads these manifests and passes them to the commands.
No test installs, removes or changes any of these files.
