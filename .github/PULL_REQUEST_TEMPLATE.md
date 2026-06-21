## Summary

What does this PR change and why?

## Related issue

Fixes # / Refs # / N/A

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Tool integration
- [ ] Documentation
- [ ] Security hardening
- [ ] Chore / refactor

## Security checklist

- [ ] **Does this PR touch `/sandbox_profiles` or `/sandbox-go`?** If yes, this PR **must** receive explicit security review before merge. Tag reviewers and describe threat impact.
- [ ] I did not add free-text command/flag inputs for tool execution.
- [ ] New presets use fixed `args` in `/tools/{tool}.json` (Nmap pattern).
- [ ] I tested on Linux with Firejail when sandbox behavior changed.

## Test plan

How did you verify this works?

- [ ] `npm run dev` (or documented alternative)
- [ ] Manual UI test
- [ ] `curl`/API test
- [ ] Other:

## Screenshots / logs

If UI or streaming behavior changed, include evidence.