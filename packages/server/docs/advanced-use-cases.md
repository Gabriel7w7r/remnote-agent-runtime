# Advanced Use Cases

This page describes longer, multi-step workflows where an AI client uses RemNote as a working knowledge system, not
only as a search backend. The examples here focus on workflows that combine search, structured reads, inline-link
traversal, exact-ID writes, and audit loops across multiple tool calls.

This page is also meant to collect advanced, practical, and occasionally cool ideas for using AI agents together with
RemNote. Contributions are welcome: open a pull request or describe your idea in an issue, especially if it is a workflow
you have already used successfully.

For short client screenshots and simple examples, see [Demo](demo.md).

## Knowledge Base Discovery and Tagging

A useful advanced workflow is to improve discoverability for one selected area of a larger RemNote knowledge base.
The user first chooses a bounded topic area, such as a technical field, work project, research theme, or long-running
personal interest.

The AI client explores the existing RemNote hierarchy with keyword searches, cursor-paged search result traversal, and
shallow structured reads of likely `document` and `concept` anchors. When promising notes are found, the client can
follow child Rems and inline Rem references, while deduplicating every candidate by exact Rem ID so the same note is
not reviewed repeatedly.

The goal is not to tag every text match, but to find standalone notes that would benefit from an additional retrieval
path outside their current hierarchy branch. Based on the discovered corpus, the user and AI client can design a small
hierarchical tag namespace whose child tags act as practical discoverability facets rather than a perfect ontology.

Proposed tag changes should be written to a review file first, with each candidate note, exact Rem ID, proposed tags,
and short evidence. After human approval, the client applies tags with exact tag Rem IDs, for example through
`remnote_update_tags`, avoiding ambiguous name-based tag lookup.

When a tag carries required properties, use `remnote_set_property` after applying the tag. Pass the target Rem ID, the
owning tag/table Rem ID, and the property Rem ID exactly; for dropdown/select values, pass the option Rem ID as a
`rem_reference` value.

Finally, the client audits the write with strict tag lookup, such as `remnote_search_by_tag` in direct tagged-result
mode, and records an applied log so future sessions can continue from durable state instead of chat history. This
pattern works especially well when false negatives are more costly than occasional broad matches, because the purpose
is better future retrieval and cross-navigation.

For a step-by-step agent-facing version of this workflow, see
[Knowledge Base Discovery and Tagging Idea File](idea-files/knowledge-base-discovery-and-tagging.md).
