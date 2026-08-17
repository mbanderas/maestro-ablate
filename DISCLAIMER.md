# User responsibility and disclaimer

Last updated: August 17, 2026

Maestro: Ablate is a general-purpose audit and measurement tool for Agent Skills. It ranks skills by context cost, audits a `SKILL.md` against a written rubric, rebuilds the file, and runs a measured ablation loop against a model the operator selects.

Two limits are inherent to the method and are stated in the skill's own documentation. **Absence of harm is not presence of benefit:** a passing ablation shows that a cut did not break the tasks that were run, not that the cut improved anything. **Results are specific to the model and CLI version measured against:** a skill trimmed against one model may under-serve the next. Reports record both for that reason, and version control is what allows a skill to be re-expanded.

Ablate output is not proof that a rebuilt skill is correct, complete, safe, compliant, or better than the original. A passing gate, a score, a diff, or a grader verdict does not establish production readiness.

Users are responsible for version-controlling skills before rewriting them, reviewing every proposed cut, budgeting the model spend a Phase B loop incurs on their own account, deleting labs that hold copied credentials, and testing rebuilt skills in real work. Independent review may be required where a skill governs legal, regulatory, medical, financial, or safety-critical work.

The [MIT License](LICENSE) governs permission to use, copy, modify, and distribute this software. The software is provided "as is" without warranty. The warranty and liability terms in the MIT License apply.
