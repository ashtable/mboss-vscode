# Third-party notices

This extension redistributes the work below. Each entry names what is
included, who wrote it, and the terms it is included under. The full text
of the font licences travels in the package beside the faces themselves,
under `media/fonts/`.

## Albert Sans

The latin subset of the variable face, shipped as
`media/fonts/albert-sans-latin.woff2` and loaded by every webview.

Copyright 2021 The Albert Sans Project Authors
(https://github.com/usted/Albert-Sans)

Licensed under the SIL Open Font License, Version 1.1. The full text is in
`media/fonts/albert-sans-OFL.txt`, and is also available with a FAQ at
https://scripts.sil.org/OFL.

## Spline Sans Mono

The latin subset of the variable face, shipped as
`media/fonts/spline-sans-mono-latin.woff2` and loaded by every webview.

Copyright 2022 The Spline Sans Mono Project Authors
(https://github.com/SorkinType/SplineSansMono)

Licensed under the SIL Open Font License, Version 1.1. The full text is in
`media/fonts/spline-sans-mono-OFL.txt`, and is also available with a FAQ at
https://scripts.sil.org/OFL.

## Lucide

Icon path data, inlined as SVG in the webview bundles rather than taken as
a dependency.

Copyright (c) Lucide Icons and Contributors

```
ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Some Lucide icons are derived from Feather, which is MIT licensed:

```
The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## react

Compiled into the webview bundles under `dist/webview/`.

Copyright (c) Meta Platforms, Inc. and affiliates.

Licensed under the MIT licence, the text of which is reproduced under
Lucide above.

## react-dom

Compiled into the webview bundles under `dist/webview/`.

Copyright (c) Meta Platforms, Inc. and affiliates.

Licensed under the MIT licence, the text of which is reproduced under
Lucide above.

## @xyflow/react

The graph the canvas is drawn with, compiled into
`dist/webview/canvas.js`.

Copyright (c) 2019-2025 webkid GmbH

Licensed under the MIT licence, the text of which is reproduced under
Lucide above.

## elkjs

The layout engine, compiled into `dist/extension.cjs`. Included
unmodified; the source is at https://github.com/kieler/elkjs.

Copyright (c) 2017, 2021 Kiel University and others

Dual-licensed under the Eclipse Public License 2.0
(https://www.eclipse.org/legal/epl-2.0/) or, at your option, the GNU
General Public License version 3 or later
(https://www.gnu.org/licenses/gpl-3.0.html). It is included here under
the EPL-2.0.

## ts-morph

The TypeScript compiler wrapper the library reads a project's handlers
with, compiled into `dist/extension.cjs` along with the TypeScript
compiler it re-exports.

Copyright (c) 2017 David Sherret

Licensed under the MIT licence, the text of which is reproduced under
Lucide above. TypeScript itself is copyright (c) Microsoft Corporation
and licensed under Apache-2.0, whose terms are at
https://www.apache.org/licenses/LICENSE-2.0.

## pg

The PostgreSQL client the run views read a ledger with, compiled into
`dist/extension.cjs`.

Copyright (c) 2010 - 2021 Brian Carlson

Licensed under the MIT licence, the text of which is reproduced under
Lucide above.

## @dbos-inc/dbos-sdk

Compiled into `dist/extension.cjs`.

Copyright (c) 2023 DBOS, Inc.

Licensed under the MIT licence, the text of which is reproduced under
Lucide above.

## @agentclientprotocol/sdk

The protocol the agent panel talks to a coding agent over, compiled into
`dist/extension.cjs`.

Copyright 2025 Zed Industries, Inc. and contributors

Licensed under the Apache License, Version 2.0, whose terms are at
https://www.apache.org/licenses/LICENSE-2.0.

## zod

Compiled into `dist/extension.cjs` and into the webview bundles.

Copyright (c) 2025 Colin McDonnell

Licensed under the MIT licence, the text of which is reproduced under
Lucide above.

## @types/node

Type declarations, shipped as files under `dist/node_modules/` because
the library resolves them while it is still loading. From
DefinitelyTyped.

Copyright (c) Microsoft Corporation

Licensed under the MIT licence, the text of which is reproduced under
Lucide above.
