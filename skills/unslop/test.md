# Unslop test

Manual regression check for the `unslop` skill. Paste the bait into a fresh
session (fresh so the global AGENTS.md writing rule loads), then grade the
rewrite against the checklist.

## Prompt

> Rewrite this to remove AI tells. Keep the meaning.
>
> # The Future Of Our Platform 🚀
> In today's rapidly evolving landscape, our groundbreaking platform serves as a testament to innovation. It's not just a tool, but a paradigm shift that will leave an indelible mark. We utilize cutting-edge technology in order to facilitate seamless workflows. Experts believe this is a pivotal moment. **Performance:** Performance was significantly improved by our team. Additionally, the intricate tapestry of features was carefully designed to enhance user delight. Despite numerous challenges, the product continues to thrive. The future looks bright.

The paragraph packs in: title-case heading, decorative emoji, "rapidly
evolving landscape", "groundbreaking", "serves as", "testament", "not just X,
but Y", "paradigm", "indelible mark", "utilize", "in order to", "facilitate",
"seamless", "Experts believe", "pivotal moment", an inline-header list, passive
voice plus adverb ("was significantly improved by our team"), "Additionally",
"intricate", "tapestry", "enhance", "Despite challenges... continues to
thrive", "numerous", and a generic conclusion.

## Pass criteria

The rewrite passes when every tell is gone:

- Heading is sentence case, no emoji.
- No em dashes anywhere.
- No "serves as / testament / paradigm / tapestry / utilize / facilitate / additionally / enhance / numerous".
- No "not just X, but Y" framing.
- No `**Label:**` inline-header that restates the line.
- Active voice with a named actor, no "significantly".
- No "Experts believe" without a name.
- No "the future looks bright" filler ending. State a fact or a plan, or stop.

## Extra checks

1. Net-new writing (tests the "add soul" half, not just deletion):

   > Write 150 words on why AI agents running overnight is both useful and a little unsettling.

   Pass = a real opinion, varied sentence length, maybe an "I", one concrete
   detail. Fail = a balanced pros-and-cons list with no voice.

2. Confirm the skill loaded:

   > Are you applying the unslop skill right now? Which of its rules did you use on the last rewrite?

   If it names specific rules, the skill is in context. If not, force it once
   with "use the unslop skill" and retry.

## Note

Skills load by description match. A plain "make this better" may not trigger
unslop. Use the words "AI tells" or "unslop" to pull it in reliably.
