---
disable-model-invocation: true
name: message-voice
description: >
  Rewrite drafted Slack messages, emails, or replies into Saurabh's voice
  before sending. Use whenever drafting an outbound message (Slack, email)
  that will be read by a person, or when Saurabh says "in my voice",
  "rewrite this", or "draft a response".
---

# message-voice — Saurabh's writing voice for outbound messages

Applies to the drafted message content only (the deliverable text a human will read), not to conversational replies to Saurabh in the agent session — those follow the caveman-mode instruction in global CLAUDE.md when active. For the message text, this skill takes precedence over the global `unslop` writing rule where the two differ. Keep the loose reply register and the spaced hyphens, even though unslop is stricter about both.

## The two registers

**Opening register** — starting a thread, making an ask, announcing something. Capitalized, complete sentences, greeting with the person's name. Casual but composed.

> Hi Lisa! Do you know how easy it would be to update signature.fueled.com
> with new branding/content?

**Reply register** — responding inside an existing thread, quick back-and-forth. Mostly lowercase, fragmentary, thinking out loud. Words like "hmm," "yeah," "seems super weird."

> hmm the only phone number I can find that ends in 4587 is Reem Hamoui who
> doesn't work here anymore. seems super weird that would be the number
> associated with it

Rule of thumb: the more a message kicks off something new or asks the reader to act, the more structured it gets. Quick back-and-forth drops the formality entirely. Forcing the composed register into a two-line reply reads as stiff — keep replies loose. Loose is not forced-lowercase, though: let capitalization fall naturally at line and sentence starts, and only keep "i" and product nouns (power bi, hapana's) lowercase.

## Voice and tone

- Warm but efficient. A greeting and a light close, but the body gets to the point fast.
- Conversational and human. Heavy contractions and casual connectors ("That said," "Asking because").
- Low-pressure and non-presumptuous. Always give the reader an easy out: "If they're still valuable I'm more than happy to keep them" / "Not sure if anyone has already talked to you about this."
- Peer-to-peer. Frame even decisions as conversations, defer to the reader's knowledge ("do you still use...?", "Do you know how easy it would be...?").

## Structure

1. Greeting plus, often, a quick flag of what kind of message this is ("Random question for you").
2. The ask or news up front, in the first sentence or two.
3. The reasoning immediately after, signposted plainly: "Asking because...", "The reason we're doing this:", "Since we only have these for legacy Fueled..."
4. Preempt concerns and soften ("I won't make any changes without talking through it with you first").
5. Close with specific, easy-to-answer questions, bulleted when there's more than one.

## Reader-first habits

- Always explain the *why* right next to the *what*. The reader never has to guess the motivation.
- Make responding trivial: yes/no or short-answer questions, never a vague "thoughts?"
- Reduce friction and anxiety. Name what the reader might worry about and handle it.
- Link reference material inline; keep the message itself short and put depth elsewhere.

## Language mechanics

- Plain, jargon-free vocabulary. Frame rationale in human terms ("people are missing out on shared context").
- Avoid AI-flavored words: delve, leverage, utilize, seamless, testament, showcase, robust, streamline. Use the plain equivalent.
- One main idea per sentence. Medium length, occasionally longer for explanation.
- Hyperlink descriptive words in the sentence rather than pasting raw URLs.
- For punctuation breaks, use spaced hyphens or double hyphens, not em dashes.
- Light on formatting; reserve bullets for action items.

## Things to avoid

- Corporate framing ("per my previous email," "as part of our ongoing initiative").
- Burying the ask under explanation.
- Making decisions sound final before the reader has weighed in.
- Forcing the composed register into quick replies.
- "just do X" for work on someone else's side - it can read as dismissing their effort; hedge with "should fix it".
- Over-promising specifics you don't need to commit to ("in a couple minutes") - cut the estimate unless it matters.
- "Not just X, but Y" framing - state the point directly.

## Sample messages

**Opening register — a quick ask**

> Hi Priya! Quick question - would it be a pain to add a "last reviewed"
> date to the onboarding docs? Asking because a few new folks weren't sure
> which pages were still current, and a date would make it obvious at a
> glance. No rush if it's fiddly.

**Opening register — an announcement with a decision**

> Hey Marcus! Wanted to flag that we're planning to move the design assets
> out of the shared drive and into the new workspace. The reason: things
> are scattered across three folders right now and people keep linking to
> old versions. I won't move anything until we've talked it through,
> though - want to make sure nothing breaks for your active projects. A
> couple of questions:
> - Anything you're actively working out of that I should hold off on?
> - Do you need time to grab links or files before the move?

**Reply register — a casual back-and-forth**

> yeah that tracks. i think the staging config got overwritten during the
> last deploy, which would explain why it only broke there

## Usage

1. Take the draft content (facts, points, links already gathered).
2. Decide register: does this open something / ask for action (opening) or is it inline in an existing back-and-forth (reply)?
3. Rewrite following structure + mechanics above. Keep every technical fact/link from the source draft — this skill changes voice, not substance.
4. Present the rewritten message for confirmation, just the message, so it's easy to copy/paste
