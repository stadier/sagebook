# Sagebook — the Financial Operating System

> Your money has a lot to say. Sagebook gives it a voice.

Sagebook is not a budgeting app you visit once a month. It is a **financial
operating system** — the place you keep open in a tab, pull up on your phone,
and talk to whenever something financial happens. You capture the moment it
occurs; Sagebook files it, understands it, and can answer for it later.

This document is the north star for the product's positioning. Every surface,
doc, and empty state should read like it came from the same place.

---

## 1. The idea in one line

**Sagebook is the financial OS for your life and ventures — a single, always-on
surface where you speak, type, snap, or forward anything money-related, and it
becomes a living, queryable record.**

Two words carry the whole product:

- **Operating system.** Not a report you generate — a system that is always
  running underneath your financial life. Capture, memory, and understanding
  in one place, the way an OS quietly runs everything on a machine.
- **Voice.** You don't fill in forms; you *tell Sagebook what happened* and
  *ask it what's going on*. The interface is a conversation, not a spreadsheet.

## 2. Meet Sage — the financial voice

The product is **Sagebook**. Its interface — the part you talk to — is **Sage**.

Sage is the financial voice of the platform. You reach Sage the same way every
time: a single prompt that is always within reach.

> **"Paid ₦2.5m deposit for the Ibeju-Lekki plot yesterday, plus 150k to the
> surveyor."**  → Sage captures it, splits it, files it under Real Estate
> Investment, and drops it in your inbox to confirm.

> **"How much have I put into land this year?"**  → Sage generates a dashboard,
> right there on the canvas, from your real ledger.

The same voice does both jobs — **capture** and **understand** — because to the
user they are one motion: *tell Sagebook about your money, ask Sagebook about
your money.* "Voice" is meant literally, too: talking to Sage includes the
microphone, not just the keyboard.

### Sage's principles

1. **One prompt to rule it.** There is always a single place to say or ask
   anything. No hunting through menus to log a purchase or pull a number.
2. **Capture beats classify.** Getting the event *in* is sacred and instant.
   Understanding, categorizing, and reconciling can happen a beat later, in
   review. Never make the user do accounting to record a fact.
3. **Nothing is trusted until a human nods.** Everything Sage extracts lands in
   a review inbox. Sage proposes; you dispose. This is what makes an AI ledger
   safe to actually rely on.
4. **Answers are generated, not pre-built.** The dashboard is not a fixed page
   you navigate to — it is *rendered in response to what you asked*. The canvas
   starts empty and fills with exactly the view your question implies.
5. **Plain, calm, and quiet.** The surface is mostly empty space and one clear
   invitation. Sagebook is a tool you trust with money; it should feel composed,
   never busy or loud.

## 3. Where the voice lives

Sage has two windows onto **one conversation**, and which one you are looking
through is a matter of how much room you want, never of losing your place.

- **The dock.** A resizable panel on the right of every page, on `⌘J`. It
  *pushes* the app rather than covering it, so you can read the ledger and ask
  about the ledger at once — and because it knows which screen you are on, "why
  is this uncategorised?" has something to refer to.
- **The console** (`/console`). The same thread, full-screen: history gets a
  permanent rail, answers get their generated dashboard panels underneath, and
  the query traces open up. "Dock to the side" hands it back mid-sentence.

Conversations are remembered, so a follow-up lands in the light of what came
before, and an earlier question can be **asked a different way** without losing
the first — both versions stay, and a ‹1/2› switcher picks which one the
conversation continues from.

The console is the calm, focused expression of the idea:

```
┌───────────┬─────────────────────────────────────────────┐
│           │                                             │
│  Sagebook │            What's on your mind,             │
│           │               money-wise?                   │
│  ▸ New    │                                             │
│  ▸ Recent │      ┌─────────────────────────────────┐    │
│    …      │      │  Tell Sage what happened, or ask…│ 🎙 │
│           │      └─────────────────────────────────┘    │
│           │                                             │
│           │   [Summarize this month] [Net worth now]    │
│           │   [Spending by category] [What's in review] │
│           │                                             │
│  ● You    │                                             │
└───────────┴─────────────────────────────────────────────┘
```

- **Left rail.** Quiet, vertical. Brand at the top, a "New" action, every
  conversation you've had, and you at the bottom. It gets out of the way.
- **Right canvas.** Mostly empty on purpose. One hero prompt, a few suggestion
  chips to show what Sage can do, and ambient calm. When you submit, a
  **generated dashboard** appears inline — the answer to your question, drawn
  from your real data.
- **Two verbs, one box.** If what you typed reads like an event ("Paid…",
  "Received…"), Sage routes it into capture. If it reads like a question
  ("Show…", "How much…", "Summarize…"), Sage renders a dashboard. Same prompt.

Neither window replaces the classic dashboard and detail pages — those stay as
the structured, browsable surface, which is exactly what the dock sits beside.
Sage is the **front door for the financial voice**: the fastest path from a
thought about money to either recording it or seeing it.

## 4. How the voice maps to the machinery

Nothing here is a separate system. The voice sits on top of the funnel Sagebook
already has:

| The user does… | Sage… | Under the hood |
|---|---|---|
| Says/types an event | Captures it | `process-media` → rules → dedup → `pending_review` inbox (see INGESTION_PIPELINES.md) |
| Drops a receipt / PDF / statement | Reads or imports it | AI extraction or the column-mapping importer, into the same inbox |
| Asks a question | Renders a dashboard | Reads the existing `v_*` views + tables under RLS; no new backend |
| Confirms in review | Commits it | The human-in-the-loop step that makes the record trustworthy |

The console's dashboard generation is intentionally built as a small **intent
layer** (`webapp/src/lib/console/intents.ts`) today: a prompt is matched to a
known view and rendered from live data. That layer is the seam where an
LLM-driven query planner slots in later — the UI, the data access, and the
review guarantees do not change when the matcher gets smarter.

## 5. Writing in Sagebook's voice

When you write copy, docs, empty states, or marketing for Sagebook:

- **Lead with the voice, not the features.** "Tell Sagebook what happened," not
  "log a transaction." "Ask about your money," not "view reports."
- **Speak to a person with real ventures**, including cross-border and
  real-estate money (NGN land purchases, multi-currency positions). The examples
  should feel like their life, not a demo.
- **Be calm and plain.** Short sentences. No exclamation marks selling the
  product to itself. Confidence, not hype.
- **Never imply the AI is the authority.** Sage *suggests*; the person decides.
  Say "for you to confirm," not "done."

---

*Companion docs:* [WEBAPP_DESIGN.md](WEBAPP_DESIGN.md) for the app's IA and
screens, [INGESTION_PIPELINES.md](INGESTION_PIPELINES.md) for how captured
events actually flow into the ledger.
