# SORA SYSTEMS spec ad: assets list (step 2, needs your OK)

Nothing below gets downloaded or copied until you OK it. Every item will be logged in `assets_in/CREDITS.md`.

## A. Provided by you: done, no download

| Asset | File | Notes |
|---|---|---|
| Official logo | `assets_in/SORA_LOGO.pdf` | 1080×1080 artboard, white mark on #0030FD |
| Mark, vector | `assets_in/sora_mark.svg` | Single path extracted from the PDF, untouched; rendered and checked in blue and white |
| Brand blue | **#0030FD** (from the PDF) | Note: your earlier PNG measured #0050FF. The ad uses the PDF value |
| Background ramp | #00073A → #96C5F8 (your gradient) | Navy end for the stage, full ramp for the horizon haze |

The PDF has the mark only. **SORA SYSTEMS** will be set in type (section C) next to it, the way the reference sets its wordmark.

## B. Card copy (my call, based on your four services): needs your OK

Each card has a title, a live status that flips to done, a file name, a code panel written line by line, and a green ✓ chip at 07:00. The code and counts are **illustrative run output, not performance claims**. No uptime %, savings or client names.

**1 · AI TRANSFORMATION**: "Automate operations" · *Mapping workflows… → Rollout plan ready* · `transform.py`
```python
workflows = audit(org.processes)
for wf in workflows:
    if wf.repetitive and wf.rule_based:
        plan.add(automate(wf))
plan.prioritize(by="impact")
plan.rollout(phase="pilot")
```
Chip: `✓ 37 workflows`

**2 · CLOUD**: "Migrate to the cloud" · *Provisioning infrastructure… → Deployed* · `main.tf`
```hcl
module "platform" {
  source    = "./modules/k8s"
  region    = "eu-central-1"
  replicas  = 3
  autoscale = true
}
```
Chip: `✓ 3/3 healthy`

**3 · AGENTIC AI**: "Deploy support agent" · *Resolving tickets… → Inbox cleared* · `agent.ts` (the push-in card)
```ts
const agent = createAgent({
  tools: [crm, email, calendar],
  memory: 'long-term',
  guardrails: 'strict',
})
await agent.run('triage inbox')
```
Chip: `✓ 128 resolved`

**4 · CUSTOM SOFTWARE**: "Build client portal" · *Writing components… → Tests passing* · `Portal.tsx`
```tsx
export function Portal({ user }) {
  const { data } = useInvoices(user.id)
  return (
    <Dashboard>
      <InvoiceTable rows={data} />
    </Dashboard>
  )
}
```
Chip: `✓ 42/42 tests`

**Other UI text:**
- Clock pill: `11:58 PM` racing to `07:00 AM`.
- Button: **Approve all**.
- End card: `business@sorasystems.tech`.

## C. Fonts: download needed, needs your OK

SF Pro Display and SF Mono are a problem here:
- **They aren't available in this cloud session.**
- **Apple's licence only covers UI mock-ups for Apple platforms**, so using them in an ad is outside it.

| Use | Font | Source | Licence |
|---|---|---|---|
| Wordmark, slogan, card titles, clock, button | **Inter Display** (Inter, optical size "Display") | Google Fonts (fonts.google.com/specimen/Inter) | SIL OFL 1.1 |
| Card code | **JetBrains Mono** | Google Fonts (fonts.google.com/specimen/JetBrains+Mono) | SIL OFL 1.1 |

If you hold your own SF Pro / SF Mono licence and still want them, attach the font files and I'll use those instead.

## D. SFX: your library can't be reached from the cloud, so I need your call

`/Volumes/Extreme Pro/EDITING PACK/FOUR Editors Sound Effects` is on your SSD, and this session runs in a cloud container. Two ways forward:

**Option 1 (keeps your rule):** attach the files from your library here in chat, either individual files or a zip, about 22 in total:

| # | Slot | What to pick from the pack |
|---|---|---|
| 1 | Ember rise | Short airy riser / fire crackle |
| 2 | Sun swell | Tonal riser (≈0.5 s) |
| 3 | **Flash hit** | Cinematic impact with sub |
| 4 | Shockwave | Wide whoosh |
| 5 | Sparks | Sparkle / sizzle |
| 6 | Spark suck | Reverse whoosh |
| 7 | Split | 2 fast whooshes |
| 8 | Card land | UI thunk / glass pop |
| 9 | Clock | Clock tick (single tick, I'll sequence it) |
| 10 | Typing / data | Keyboard or digital data blips |
| 11 | Camera push / pull | Smooth camera whoosh |
| 12 | 07:00 | Bell / ding / notification chime |
| 13 | Chip pop | Small UI pop |
| 14 | Stack | Whoosh + soft thud |
| 15 | Checkmark | Swipe / swoosh + light hit |
| 16 | Button appear | UI pop |
| 17 | **Click** | Mouse click + hit |
| 18 | Comets | Pitched / sci-fi whoosh (I'll repitch ×4) |
| 19 | Suck to silence | Reverse suck |
| 20 | **Horizon hit** | Biggest impact + sub drop + shimmer |
| 21 | Wordmark sweep | Shimmer / light sweep |
| 22 | End sting | Soft logo hit / sting with tail |

**Option 2:** I synthesize every SFX in code (numpy/scipy, as in the last film). It's faster, and fully original, but it **breaks your "SFX only from my library" rule**, so I'll only do it if you say so.

## E. Music

Original, made in code (§6 of the brief). No assets.

## F. Photos

None. The reference is pure motion graphics, so there are no Unsplash or Pexels downloads.

---

**To approve, reply with:**
1. Card copy (B): OK, or edits.
2. Fonts (C): OK to download Inter + JetBrains Mono, or attach SF Pro / SF Mono.
3. SFX (D): Option 1 (attach files) or Option 2 (synth).

Then I'll build **Preview v1 (16:9)** plus a contact sheet.
