# REG24 — Modular Regulatory Infrastructure for AI (P0 Thailand)

REG24 is a modular, machine-readable legal and regulatory intelligence infrastructure designed to serve AI agents, **LAW24**, **TRACE24**, **VIBE24**, and third-party enterprise applications through a single unified **MCP (July 28, 2026 Specification)** and **REST API** gateway.

## Mandatory P0 Thai Legal Modules

| ID | Module | Technical ID | Canonical Relationship |
| :--- | :--- | :--- | :--- |
| **P0-01** | Corporate Law | `reg24.corporate.th` | Consumes canonical CCC Book III Title XXII from `reg24.civil.th` + PLCA + FBA + DBD |
| **P0-02** | Contract Law | `reg24.contract.th` | Consumes canonical CCC Books I–III from `reg24.civil.th` + UCTA + ETA |
| **P0-03** | Civil & Commercial Code | `reg24.civil.th` | **Canonical Foundation Owner** across Books I–VI (General, Obligations, Specific Contracts, Property, Family, Succession) |
| **P0-04** | Tax Law | `reg24.tax.th` | Revenue Code (CIT, PIT, VAT, WHT, SBT, Stamp Duty) + BOI Sec. 31 ring-fenced interaction |
| **P0-05** | Labor Law | `reg24.labor.th` | LPA + SSA + WCA + OSHEA + consumes canonical CCC Hire of Services (Sec. 575–586) |
| **P0-06** | BOI Investment Promotion | `reg24.boi.th` | Investment Promotion Act + BOI Ann. 8/2565 & 2026 Guide (Eligibility, Incentive & Compliance Engines with strict 4-state separation) |

## Key Architecture & Legal Controls

1. **Canonical Legal Store (`REG-CORE-003`)**: Thailand's Civil and Commercial Code provisions are stored once in `reg24.civil.th` and referenced across Corporate, Contract, and Labor modules without duplicating statutory text.
2. **BOI 4-State Legal Control (`Section 3.6`)**: Explicitly separates `potential_eligibility_evaluated`, `application_submitted`, `boi_approved_pending_certificate`, and `incentive_entitlement_verified`.
3. **Knowledge Coverage vs. Executable Rules (`REG-RULE-001` to `004`)**: Complete corpus retrieval with SHA-256 provenance across all six modules, paired with human-approved deterministic rules (`executable_approved`).
4. **Windows Phone (Metro) Modern Minimal Console (`Section 11`)**: Live Tiles panorama hub and all 8 administrative screens (Screens A–H) with Simple Admin / Expert Engineering view toggle.

## Commands

```bash
npm install
npm test        # Run P0 Acceptance Test Suite (REG-QA-001 to 008)
npm run build   # Production Next.js build
npm run dev     # Start local server
```
