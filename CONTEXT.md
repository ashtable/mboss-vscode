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
the reason a trace with no picture beside it draws as one nameless group.
`unasked` means nobody looked: a watch polls a database and never had a
document, so the grammar's answer about a row's block is the only evidence
there is, and gating on a drawing nobody consulted would tell the canvas that
every row belongs to nothing.

The two used to share `undefined`, and meant opposite things by it.

`src/runs/reading.ts:Drawing`

### evidence

What a particular reader holds about a run, which is not the same for all of
them. The run list has one recorded name per run and no rows; the run page has
every row the run wrote; a watch has every row and a clock. Questions like
"is this run parked" take the answer as an argument rather than deriving it,
because deriving it needs evidence the caller may not have — which is how the
run page came to ask a question about a column its own query never selected.

`src/runs/view.ts:severityOf`
