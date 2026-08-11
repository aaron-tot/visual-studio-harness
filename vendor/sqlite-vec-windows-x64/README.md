# sqlite-vec-windows-x64/vec0.dll

Windows native extension for sqlite-vec `0.1.9`, providing the `vec0` virtual
table used for vector search. Vendored into the repo because `bun install` on a
non-Windows host does not materialize this `os:["win32"]` optional dependency,
so a Linux→Windows cross-build would otherwise embed the wrong (Linux) library.

Provenance: https://registry.npmjs.org/sqlite-vec-windows-x64/-/sqlite-vec-windows-x64-0.1.9.tgz
Verify: `file vec0.dll` → `PE32+ executable for MS Windows (DLL), x86-64`

The build scripts (`scripts/build-prod.ts`, `scripts/build-installer.ts`) fall
back to this file for `bun-windows-x64` targets when the node_modules package
isn't present. To refresh, re-download the tarball above and replace `vec0.dll`.
