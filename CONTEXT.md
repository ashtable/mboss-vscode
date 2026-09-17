# CONTEXT

The words this repository uses for the things it is made of.

This is the **extension's** glossary. The engine's is
`mboss-core/CONTEXT.md`, and everything it names — drawing, workflow document,
block, node, manifest, code-behind, diagnostic, spec, revision, proposal,
project, run, row, recorded name, park, replay — is used here with the same
meaning and is not repeated below. A term belongs in this file when it names
something the extension decided and core has no opinion about.

Like core's, this is a glossary and not the design. The architecture is
`CLAUDE.md`; where the two disagree about a name, the code decides and both get
edited.

## Reading a run

### reading

One projection of a run's rows, made once and read by everybody who draws
something about that run: the rows attributed to their blocks, the window they
are drawn in, and where the run has got to.

There used to be three — one for the chart, one for the trace, one for the
canvas overlay — each deriving the same facts from the same rows and each
taking its own clock. The reading is the answer to a run; asking twice is how
two answers came to disagree.

`src/runs/reading.ts`

### attribution

Deciding which block a recorded row belongs to. Two questions, deliberately
kept apart: which block the row's **name** says it is, which the compiler's
grammar answers without seeing a document; and whether that block still
**exists**, which only the drawing answers.

`src/runs/reading.ts:attributed`

### unmapped

A row that names no block anybody can click — either the grammar could not read
the name, or the drawing was consulted and does not have that block. One of the
three owners a row can have, beside `node` and `sdk`.

Not the same as "no block": a run parked on a block somebody has since deleted
is still parked, and the reading says so.

`src/runs/reading.ts:OperationOwner`

### unasked, lost

What a reader knows about the drawing, where it is not holding one. `lost`
means it looked and the project has no document of that name — an answer, and
the reason a trace with no picture beside it draws every row apart, under no
block.
`unasked` means nobody looked: a watch polls a database and never had a
document, so the grammar's answer about a row's block is the only evidence
there is, and gating on a drawing nobody consulted would tell the canvas that
every row belongs to nothing.

The two used to share `undefined`, and meant opposite things by it.

`src/runs/reading.ts:Drawing`

### evidence

What a particular reader holds about a run, which is not the same for all of
them. The run list has one recorded name per run, when its sleep ends and no
rows, read against one clock for the page; the run page has every row the run
wrote; a watch has every row and a clock. Questions like "is this run parked"
take the answer as an argument rather than deriving it, because deriving it
needs evidence the caller may not have — which is how the run page came to ask
a question about a column its own query never selected.

`RunEvidence` is that shape for the one question every surface asks —
where the run has got to — and `parked` is the part of it only the reader
can answer.

`src/webview/states.ts:RunEvidence`

### word

Where a run or a step has got to, in the one lowercase vocabulary every
panel says it in — `done`, `running`, `recovering`, `waiting`, `queued`,
`failed`, `gave up`, `cancelled` for a run, and four of those for a step —
as against the ledger's own status, which is DBOS's and is printed only where
a row is shown as evidence.

One crossing between the two, and it takes its evidence rather than reading it:
whoever read the run answered "parked" — the run tab from every row it wrote,
the list from one recorded name and a sleep's end, a read with neither saying
`false` — and the crossing says the word. There used to be three, each with its
own copy of the ledger's words, and they disagreed about a status none of them
had heard of: one ticked it as done, two said it was still going.

`src/webview/states.ts:runWord`

### selected row

The row the Runs list has marked and opened out to show its actions. The
list's own: only a row picked on the list moves it, the newest run is marked
until somebody picks another, and a read that no longer holds the marked run
marks the newest instead.

Not the run somebody has open. Opening a run is what the run tab, the
Inspector, the transcript and the list's Open on canvas all ask for, and none
of them moves the mark. The two used to be one, so a click on a row opened a
tab.

`src/runs/history.ts:selectRow`

## The Inspector

### surface

A thing a block is picked on, and the Inspector is about: a canvas, or the
run tab. Each answers the same questions about the block picked on it and
takes the same verbs — a face, a selection, an edit, the ways into its code
and its recorded values — from what it holds: a canvas from its own session,
the run tab from the store's reading of the run and the document as the
editor holds it. The pane routes every message about a block to the surface
the message names, never to whatever is in front when it arrives.

The Runs list is not one: nothing is picked on it. The word is used more
loosely elsewhere in the code ("the two surfaces a run history has", "three
surfaces ask for it"); this is the sense the Inspector means, and the one a
glossary entry was owed for.

`src/inspector/surface.ts:BlockSurface`

### line

One thing the Configure face draws under a header: a field, two number fields
that are one limit between them (a count and the period it is counted over),
or a value read off the file and set nowhere (the workflow a trigger starts).
The plan of a form is the block's name, the lines before any header, and its
groups of lines; the face walks the plan and knows no field by its id. "Line"
rather than "row", because a row is what the ledger writes and what is picked
on the run tab.

`src/inspector/forms.ts:FormLine`
