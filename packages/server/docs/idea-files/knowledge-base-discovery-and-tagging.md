# Knowledge Base Discovery and Tagging

A pattern for using a personal AI agent to improve discoverability in an existing RemNote knowledge base.

This is an idea file: it is meant to be copied or linked into an AI agent session. Its goal is to communicate the
workflow, constraints, and safety model. The agent should adapt the exact searches, files, tag names, and review process
to the user's own RemNote database and preferences.

The format is inspired by Andrej Karpathy's "idea file" framing for sharing high-level agent workflows:
<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>.

## The Core Idea

Many long-running knowledge bases grow organically. A user may have years of carefully written notes, but the hierarchy
is usually not perfect. Important notes can live in project folders, daily logs, imported documents, or older topic
branches where they made sense at the time but are hard to find later.

The goal of this workflow is to add a second navigation layer: a small, deliberate tag hierarchy for one bounded topic
area. The tag tree is not meant to replace the existing RemNote hierarchy. It adds retrieval paths across hierarchy
branches, so related notes can be rediscovered even when they were originally filed in different places.

This is especially useful when the cost of false negatives is higher than the cost of some broad matches. If the goal is
discoverability, it is often better to tag a few borderline notes than to miss notes that would later be useful.

## When To Use This

Use this workflow when:

- the user has a non-trivial RemNote knowledge base
- notes are organized mostly by hierarchy rather than tags
- one topic area is important enough to improve first
- relevant notes are likely spread across multiple branches
- the user wants agent help but still wants review before writes

Good first topic areas are bounded but meaningful: a work project, a technical domain, a research interest, a recurring
life area, or a tool ecosystem.

Avoid starting with the entire knowledge base. The first pass should be a useful pilot, not a perfect global taxonomy.

## Working Assumptions

The agent should assume access to RemNote through MCP tools or equivalent connector commands.

Useful capabilities include:

- status check for the RemNote connection
- full-text search with a limit and cursor or paging support
- structured reads of notes and child Rems
- inline Rem reference metadata, if available
- exact Rem ID access for notes and tags
- exact tag updates by tag Rem ID
- strict search by tag Rem ID for audit

If the connector lacks one of these capabilities, adapt the workflow and document the limitation before continuing.
Do not hide connector limitations in chat history; record them in the durable working notes for the project.

## Human Policy Choices

Before crawling or writing, ask the user to decide:

- topic scope: what area should be improved first
- write policy: review-only, approved batches, or fully delegated writes
- false-positive tolerance: strict taxonomy or recall-friendly tagging
- target note types: documents, concepts, text notes, or a mix
- local artifact location: where progress files should be written
- naming style for tags: lowercase, kebab-case, aliases, descriptions, or another convention

For discoverability work, a recall-friendly policy is often best: borderline notes can be tagged if they plausibly help
future retrieval. The user can later remove noisy tags after seeing real search results.

## Durable Working Files

The agent should create durable files outside chat history. This makes the workflow resumable and reviewable.

Suggested files:

- `candidate-index.md` - deduplicated table of discovered candidate notes
- `candidate-details.md` - short evidence snippets and read-back notes for candidates
- `tag-taxonomy.md` - proposed tag hierarchy, descriptions, aliases, and exact tag Rem IDs
- `tagging-batch-001-review.md` - first human-reviewable write batch
- `tagging-batch-001-applied.md` - exact writes performed and audit results
- `discovery-log.md` - seed queries, cursors, traversal choices, and unresolved questions

Keep these files concise and append-friendly. The goal is continuity, not a second knowledge base.

## Step-By-Step Process

### 1. Orient on the Knowledge Base

Start with a connection status check and a small read-only smoke test. Confirm that the agent can search, read notes,
see exact Rem IDs, and distinguish `document`, `concept`, and `text` Rems if the connector exposes `remType`.

Ask the user for the initial topic area and any known anchors. An anchor can be a root document, a major concept, a
project folder, a common abbreviation, or a set of likely keywords.

### 2. Run Seed Searches

Search for a small set of seed terms. Use synonyms, abbreviations, product names, project names, and known people or
organizations if they are relevant to the topic.

For each result, record:

- exact Rem ID
- title or headline
- parent title and parent Rem ID
- `remType`, if available
- seed query that found it
- initial relevance judgment

Use cursor paging when available. If search has no stable paging, document the limitation and use more targeted seed
queries instead of pretending the pass is exhaustive.

### 3. Read Promising Anchors

For likely `document` and `concept` anchors, read the note with structured content at a shallow depth. Increase depth
only when the branch looks relevant.

Look for:

- child documents or concepts
- repeated concepts that suggest tags
- inline Rem references
- notes filed under unrelated hierarchy branches
- user-authored summaries or project notes that deserve better retrieval

Prefer tagging standalone `document` and `concept` Rems. Tag `text` Rems only when they are meaningful standalone
knowledge objects or when the user's RemNote style makes text Rems important retrieval targets.

### 4. Follow Inline References Carefully

Inline Rem references are useful discovery edges, but they can create loops. Treat the RemNote graph as cyclic.

Maintain a visited set by exact Rem ID. If a note appears through multiple queries or references, merge the evidence
under one candidate entry instead of duplicating the note.

Do not recursively crawl without bounds. Use depth limits, query limits, and periodic review checkpoints.

### 5. Build a Candidate Map

Create a deduplicated candidate index. Classify each candidate as one of:

- `likely` - clearly belongs in the topic area
- `possible` - plausibly useful for discoverability
- `context` - useful for navigation or background but probably not a direct tag target
- `reject` - searched or traversed but should not be tagged

For each `likely` or `possible` candidate, write short evidence. The evidence should be enough for the user to approve
or reject without reopening every note manually.

### 6. Propose a Small Tag Hierarchy

Based on the discovered corpus, propose a small hierarchical tag tree.

Good tags are:

- specific enough to retrieve a useful subset
- broad enough to apply to multiple notes
- stable enough to survive future notes
- understandable to the user without the original chat context
- optionally documented with child description Rems

Avoid designing a perfect ontology. This is a practical retrieval interface.

### 7. Create the Tag Tree

After user approval, create the tag namespace in RemNote. In RemNote, tags are Rems, so tags can themselves be
hierarchical and can have descriptions or aliases.

Record the exact Rem ID of every created tag in the local tag taxonomy file. Future writes should use exact tag Rem IDs,
not names, because names and aliases can be ambiguous.

If adding description nodes under tags, keep the convention simple and consistent. For example:

`description: use for notes about agent-assisted coding workflows`

### 8. Prepare a Review Batch

Write a review file before applying tags.

Each proposed write should include:

- target note title
- target note Rem ID
- parent context
- proposed tag names and exact tag Rem IDs
- confidence level
- short evidence

Start with a small high-confidence batch. After the user sees the quality, continue with lower-confidence or
recall-friendly batches if the goal is broad discoverability.

### 9. Apply Approved Tags

Apply only user-approved batches unless the user explicitly delegated writes.

Use exact tag Rem IDs. Avoid name-based tag mutation. Do not replace existing unrelated tags unless the user explicitly
asked for cleanup. Prefer additive tagging.

After each write, record the action in an applied log.

### 10. Audit The Writes

Audit with strict tag lookup by tag Rem ID, not noisy full-text search.

For each applied tag, confirm that expected target notes appear in direct tagged results. Record mismatches, connector
limitations, or notes requiring manual inspection.

If the connector exposes different result modes, use the strict direct-tagged mode for audit and the context/navigation
mode for exploration.

### 11. Iterate

After the first applied batch, continue discovery.

The agent can:

- expand seed queries based on discovered aliases and repeated terms
- follow more inline references
- inspect untagged siblings of tagged notes
- search for notes matching tag names but not yet tagged
- propose additional tags or aliases only when the corpus justifies them

Work in small loops: discover, deduplicate, review, write, audit, log.

## Resume Protocol

At the start of a later session, the agent should not restart from scratch.

First read:

- the tag taxonomy file
- the candidate index
- the latest review batch
- the latest applied log
- the discovery log

Then determine:

- which candidates are already applied
- which candidates were rejected or postponed
- which seed queries and cursors were already exhausted
- which connector limitations were discovered
- what the next smallest useful batch should be

The durable files are the state. Chat history is optional.

## Safety Rules

- Prefer read-only discovery until the user approves a write batch.
- Use exact Rem IDs for notes and tags.
- Do not perform destructive hierarchy edits during tagging work.
- Do not replace child content when only tags need to change.
- Keep local review and applied logs current.
- Verify writes with strict tag lookup.
- Stop and document the blocker if the connector cannot distinguish direct tag matches from search-context matches.

## What Success Looks Like

The workflow is successful when:

- the user can search or browse by the new tag hierarchy
- important notes outside the obvious hierarchy branch become easier to rediscover
- the tag tree is small enough to understand
- applied writes are auditable by exact Rem ID
- future agents can resume from local files without reading the original chat

The best result is not a perfect taxonomy. The best result is a knowledge base that is easier to use next month.
