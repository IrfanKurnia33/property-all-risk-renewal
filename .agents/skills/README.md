# Repository-local skills

The skills in this folder are installed only for the `insurance-broker-ai-id`
repository, following the [repository skill locations in the OpenAI documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
Source versions and local adaptations are recorded in [sources.lock.json](sources.lock.json).

Git tracks this registry and its source lock. Installed skill folders are ignored;
a fresh checkout needs those tools installed locally before invoking them.

| Source package | Available skills | Requirements |
| --- | --- | --- |
| [Taste](https://github.com/Leonxlnx/taste-skill) | `design-taste-frontend` — UI guidance and browser checks | Node 22+ and Chrome/Edge/Chromium; ffmpeg is optional. Node 24 and a browser were available on this machine at installation time. |
| [Ponytail](https://github.com/DietrichGebert/ponytail) | `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help` | Instruction-only skills; no additional runtime required. |
| [Graphify](https://github.com/Graphify-Labs/graphify) | `graphify` — build, update, and explore a knowledge graph | The skill and its eight references are installed. The `graphifyy==0.9.106` runtime requires Python >=3.10,<3.15. |

Invoke a skill by name, such as `$design-taste-frontend`, `$ponytail`, or
`$graphify`. Skills are available on the next turn; if they do not appear,
reload the Codex session. Skill use remains within the scope of the requested task.

This installation copies the skills, supporting resources, and licenses. No
global configuration, plugin lifecycle hooks, MCP, or knowledge graph has been
enabled. Taste's Claude Stop-hook metadata was removed from the Codex copy;
its browser check scripts remain available. Follow the renewal application's
needs when selecting Taste design guidance.

The Graphify runtime is not installed yet. Python 3.15 is currently available,
while the installed Graphify version supports Python 3.10–3.14. For the first
Graphify task, use a compatible Python interpreter and a venv at
`.tools/graphify/.venv`, following `graphify/SKILL.md` after installing the local skill.
Do not use a global installer. Set `GRAPHIFY_NO_AUTO_REFRESH=1` in the process
running Graphify to prevent it from updating skills in user directories.

The product reference remains `docs/renewal-flow-v2/renewal-flow-v2.md`; the
first version is historical. Installing these skills does not start prototype
implementation.
