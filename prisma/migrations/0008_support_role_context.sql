-- REG24 Candidate 12 (Workstream C3): Allow `support_role = 'context'` on `citation_claim_evidence_link`
-- so sibling decree passages (e.g., RD 799 + RD 807 §1-2 & §3) can be attached as explicit context
-- without altering governing authority passages or touching any existing rows.

ALTER TABLE citation_claim_evidence_link
  DROP CONSTRAINT IF EXISTS citation_claim_evidence_link_support_role_check;

ALTER TABLE citation_claim_evidence_link
  ADD CONSTRAINT citation_claim_evidence_link_support_role_check CHECK (
    support_role IN (
      'primary_authority',
      'statutory_premise',
      'ruling_application',
      'judicial_reasoning',
      'exception_or_proviso',
      'transitional_applicability',
      'requester_factual_context',
      'official_summary_scope',
      'verified_attachment_authority',
      'context'
    )
  );
