# Working on BallotGap with Claude

This is the workflow that keeps vibe-coded civic tools trustworthy. It follows [Anthropic's Claude Code best practices](https://code.claude.com/docs/en/best-practices), adapted for a small static site.

## The loop: explore → plan → change → verify

1. **Explore.** "Read CLAUDE.md and js/app.js. Explain how the address lookup decides on a match. Don't change anything yet."
2. **Plan.** "I want X. Which files change? What could break for screen reader users or Spanish speakers? Give me a short plan."
3. **Change.** Ask for small, targeted edits, never "rewrite index.html." Whole-file rewrites are how earlier fixes quietly disappear.
4. **Verify.** "Run `npm test` and `SCREENSHOTS=shots npm run test:e2e`. Show me the output and both screenshots." Ask for evidence, not "done."
5. **Review.** "Use the a11y-reviewer agent on this diff." A fresh reviewer catches what the author missed.
6. **Ship.** Open a pull request and let CI run before you merge.

## Prompts that work well here

- **Election update:** "Add the [date] election to js/config.js from this official page: [vote.phila.gov link]. Include English and Spanish milestones. Run npm test."
- **New feature:** "Interview me with questions about [feature] first: who it's for, edge cases, privacy, and Spanish. Then write a plan."
- **Bug:** "Users report [symptom] on [device/AT]. Write a failing test that reproduces it, then fix it and show the test passing."
- **Design tweak:** "Change [thing] using only the tokens in css/styles.css. Take 375px and 1280px screenshots before and after."

## Habits

- Start a fresh session for each unrelated task, so old context doesn't leak into new work.
- If you've corrected Claude twice on the same thing, start over with a clearer prompt that includes what you learned.
- When Claude makes the same mistake twice, add one line to CLAUDE.md. Keep that file short, because long rule lists get ignored.
- Don't paste API keys or voter information into a session. This project needs neither.
- Reuse this setup (CLAUDE.md, `npm test`, `scripts/check.mjs`, CI) in your other tools. The check script works with small changes on any single-page civic tool.
