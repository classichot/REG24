"use client";

import React, { useState, useEffect } from "react";

export type LandingThemeVariant = "v3-paper" | "v2-dark" | "v1-crimson";
export type LandingTaglineVariant = "layer" | "sources" | "machine";
export type LandingLang = "en" | "th";

export interface Reg24LandingPageProps {
  defaultLang?: LandingLang;
  onLangChange?: (lang: LandingLang) => void;
  defaultVariant?: LandingThemeVariant;
  defaultTagline?: LandingTaglineVariant;
  signedIn?: boolean;
  onOpenWorkspace?: (opts?: {
    nav?: "research" | "workspace" | "documents" | "databases" | "notebook" | "mcp" | "developer" | "control" | "modules";
    query?: string;
    roleIndex?: number;
  }) => void;
}

interface SourceItem {
  title: string;
  issuer: string;
  ref: string;
  extract?: string;
}

interface SampleItem {
  q: string;
  summary: string;
  points: string[];
  sources: SourceItem[];
  dates: string;
  missing: string[];
  next: string[];
}

const LANDING_T = {
  en: {
    nav: {
      product: "Product",
      useCases: "Use cases",
      law: "Law as Code",
      pricing: "Pricing",
      developers: "Developers",
      signIn: "Sign in",
      trial: "Start free trial",
      workspace: "Open workspace",
      menu: "Menu",
    },
    hero: {
      eyebrow: "Thai legal intelligence for practitioners and AI systems",
      taglines: [
        {
          a: "The legal intelligence layer",
          b: "for law practitioners in the AI age.",
          hook: "AI can draft the memo in seconds. REG24 shows you which Thai statute and section it stands on.",
        },
        {
          a: "AI answers fast.",
          b: "REG24 answers with sources.",
          hook: "Every answer arrives with the section, the issuing body and the date it was checked.",
        },
        {
          a: "Law, made machine-readable.",
          b: "Practice, made sharper.",
          hook: "Rules become checkable conditions — so you see exactly which facts lead to which result.",
        },
      ],
      sub: "REG24 sits between the law and your work. It finds the rules that apply, explains them in plain language and traces every answer to its source — for lawyers, advisers and compliance teams, and for the AI tools they rely on.",
      primary: "Start free trial",
      secondary: "See a sample answer",
      support: "Explore an example, then bring your own question.",
      scopeLabel: "Scope",
      scope:
        "Thai corporate, commercial and regulatory law — 38 laws across 19 industries today. REG24 supports research and preparation for review; it does not replace professional advice.",
      scopeLink: "Explore supported coverage",
    },
    ui: {
      sample: "Sample",
      sampleAnswer: "Sample answer",
      question: "Question",
      keyPoints: "Key points",
      summary: "Summary",
      sources: "Sources",
      dates: "Relevant dates",
      missing: "Information still needed",
      next: "Next steps",
      askMine: "Ask my own question",
      openSource: "Open source",
      ready: "Ready to ask your own question?",
      loading: "Opening the example",
      error: "The example could not be opened. Try again.",
      retry: "Try again",
      sampleNote:
        "Curated sample. Questions, answers, references and dates are approved by the REG24 legal content owner.",
      workspace: "Research",
      scope: "Thailand · current law",
      qa1: "Revenue Dept rulings",
      qa2: "Supreme Court judgments",
    },
    stats: {
      h2: "Thai law, connected. Every answer traceable.",
      body: "Every answer links back to the original legal text, so you can verify it yourself — every time.",
      label: "Inside the REG24 engine",
      note: "Figures from the live engine status · MCP 2026-07-28",
      items: [
        { n: "38", l: "Thai laws in the system" },
        { n: "19", l: "Industries covered" },
        { n: "3,995", l: "Linked nodes in the legal knowledge graph" },
        { n: "9/9", l: "Release quality gates passed" },
      ],
    },
    sampleSec: {
      kicker: "See an answer",
      h2a: "Understand the answer.",
      h2b: "Inspect the sources.",
      intro:
        "See how a business question connects to relevant requirements, source material and points that need further review.",
    },
    samples: [
      {
        q: "Which PDPA provisions govern notice and lawful basis when a client collects customer data online?",
        summary:
          "Sections 23 and 24 are the core: the controller must give notice at or before collection, and each purpose needs a lawful basis — consent is only one of several. Section 37 adds security and other controller duties. Check whether cross-border transfer rules also apply.",
        points: [
          "Define a purpose and a lawful basis for each type of data you collect.",
          "Tell people what you collect, why and for how long — before or at the point of collection.",
          "Put appropriate security measures in place and review them.",
        ],
        sources: [
          {
            title: "Personal Data Protection Act B.E. 2562 (2019)",
            issuer: "Personal Data Protection Committee",
            ref: "Section 23 · notice to the data subject",
            extract:
              "Section 23: In collecting Personal Data, the Data Controller shall inform the Data Subject, prior to or at the time of such collection, of the purpose of the collection, the retention period, the rights of the Data Subject, and the contact details of the Data Controller.",
          },
          {
            title: "Personal Data Protection Act B.E. 2562 (2019)",
            issuer: "Personal Data Protection Committee",
            ref: "Section 24 · lawful bases for collection",
            extract:
              "Section 24: The Data Controller shall not collect Personal Data without the consent of the Data Subject, unless it is necessary for the performance of a contract, compliance with a law, legitimate interests, vital interests, or public task.",
          },
          {
            title: "Personal Data Protection Act B.E. 2562 (2019)",
            issuer: "Personal Data Protection Committee",
            ref: "Section 37 · duties of the data controller",
            extract:
              "Section 37: The Data Controller shall provide appropriate security measures for preventing the unauthorized or unlawful loss, access to, use, alteration, correction, or disclosure of Personal Data.",
          },
        ],
        dates: "In force · version checked 01 Oct 2026",
        missing: [
          "Which data you collect and why",
          "Whether you use third-party tools such as analytics or payments",
          "Whether data is transferred outside Thailand",
        ],
        next: [
          "List each data field and its purpose",
          "Draft a privacy notice",
          "Check agreements with third-party processors",
        ],
      },
      {
        q: "What should I prepare before hiring my first employee?",
        summary:
          "Before your first hire, set out the employment terms in writing, register with the Social Security Office and prepare to withhold tax from wages. Some duties depend on how many people you employ and your type of business.",
        points: [
          "Employment terms — wages, working hours, leave and termination — should be documented and meet statutory minimums.",
          "The employer registers itself and the employee with the Social Security Office within the required period.",
          "Personal income tax is withheld from wages and filed monthly.",
        ],
        sources: [
          {
            title: "Labour Protection Act B.E. 2541 (1998)",
            issuer: "Ministry of Labour",
            ref: "Chapters 1–3 · general employment terms",
            extract:
              "Chapters 1–3 prescribe minimum standards for working hours (not exceeding 8 hours/day and 48 hours/week for normal work), rest periods, holidays, leave entitlements, and statutory wage protections.",
          },
          {
            title: "Social Security Act B.E. 2533 (1990)",
            issuer: "Social Security Office",
            ref: "Section 34 · employer registration",
            extract:
              "Section 34: An employer who has one or more employees shall submit a statement for registration as an employer and register insured employees with the Social Security Office within thirty days from the date the employee starts work.",
          },
          {
            title: "Revenue Code",
            issuer: "Revenue Department",
            ref: "Section 50 · withholding on employment income",
            extract:
              "Section 50(1): In the case of assessable income under Section 40(1) and (2), the payer shall deduct tax at source at each payment and remit it to the Revenue Department within seven days from the end of the month.",
          },
        ],
        dates: "In force, as amended · versions checked 01 Oct 2026",
        missing: [
          "Planned start date",
          "Whether the role is full-time, part-time or fixed-term",
          "How many employees you expect in the next 12 months",
        ],
        next: [
          "Draft an employment contract covering the terms above",
          "Prepare the Social Security registration documents",
          "Ask an adviser to review if the role is unusual",
        ],
      },
      {
        q: "What steps should I check before changing a company director?",
        summary:
          "Changing a director of a limited company usually needs a valid shareholder resolution under the company’s articles, followed by registering the change with the Department of Business Development. The change cannot be relied on against third parties until it is registered.",
        points: [
          "Check what the articles of association say about appointing and removing directors.",
          "Hold the meeting and record the resolution correctly.",
          "File the change of directors for registration.",
        ],
        sources: [
          {
            title: "Civil and Commercial Code",
            issuer: "Government Gazette",
            ref: "Section 1151 · appointment of directors",
            extract:
              "Section 1151: A director can be appointed or removed only by a general meeting of shareholders.",
          },
          {
            title: "Civil and Commercial Code",
            issuer: "Government Gazette",
            ref: "Section 1157 · registration of directors",
            extract:
              "Section 1157: When there is a change of directors, the company shall cause such change to be registered within fourteen days from the date of such change.",
          },
          {
            title: "Registration of a change of directors",
            issuer: "Department of Business Development",
            ref: "Registration guidance",
            extract:
              "DBD Registration Guidance: Form BorJor.4 must be signed by an authorized director and submitted within 14 days of the general meeting resolution, accompanied by copies of the new director's identification and meeting notice proof.",
          },
        ],
        dates: "In force, as amended · versions checked 01 Oct 2026",
        missing: [
          "Company type — private or public limited",
          "What your articles say about appointing directors",
          "Whether authorised signatory powers also change",
        ],
        next: [
          "Check your articles of association",
          "Prepare the shareholder resolution",
          "File the change with the Department of Business Development",
        ],
      },
    ] as SampleItem[],
    outcomes: {
      kicker: "What you get",
      h2: "Turn a complex question into a clearer next step",
      items: [
        {
          t: "Find relevant requirements",
          d: "Start with your situation and explore the legal and regulatory issues to review.",
        },
        {
          t: "Understand the answer and its basis",
          d: "Read a plain language summary and open the sources to examine the detail.",
        },
        {
          t: "See what comes next",
          d: "Identify what is known, what is missing and what to check before acting.",
        },
      ],
    },
    roles: {
      kicker: "Use cases",
      h2: "Start with the work you need to do",
      exampleLabel: "Example question",
      startLabel: "Suggested starting point",
      note: "Your choice is preselected when you create an account. You can change it later.",
      items: [
        {
          name: "Legal and advisory professionals",
          need: "Research issues, inspect sources and prepare points for review.",
          link: "Explore a research example",
          ex: "Which sources support the duty to notify people when collecting data through a website?",
          start: "Open a research example and inspect each source it cites.",
        },
        {
          name: "Business owners and teams",
          need: "Explore requirements relevant to running your business.",
          link: "Explore a business question",
          ex: "What should I prepare before hiring my first employee?",
          start: "Open the business sample, then adjust the facts to fit your business.",
        },
        {
          name: "Compliance and organisations",
          need: "Explore requirements relevant to your work and issues to follow.",
          link: "Discuss team use",
          ex: "Which steps should our team track when a company director changes?",
          start: "Talk to us about team access and review workflows.",
        },
        {
          name: "Individual users",
          need: "Start with your question and explore relevant sources.",
          link: "Start my question",
          ex: "What should I check before signing an employment contract?",
          start: "Ask your own question straight away — no setup needed.",
        },
      ],
    },
    how: {
      kicker: "How it works",
      h2a: "Start simply.",
      h2b: "Explore the detail when you need it.",
      steps: [
        {
          t: "Describe your question",
          d: "Type a question or choose an example. Include the relevant facts and time period.",
          ex: "“We plan to hire our first employee in Bangkok next month.”",
        },
        {
          t: "Review the explanation and sources",
          d: "Read the key points and examine the material supporting the answer.",
          ex: "Social Security Act B.E. 2533 · Section 34",
        },
        {
          t: "Prepare your next step",
          d: "Review missing information and points to check before applying the findings to your situation.",
          ex: "Still needed: planned start date",
        },
      ],
    },
    law: {
      kicker: "Law as Code",
      kickerPreview: "Law as Code Preview",
      h2: "See which conditions lead to which result",
      intro:
        "Explore an example of a requirement expressed as checkable conditions. See how the supplied facts, matched conditions and source material connect to a result.",
      scenarioLabel: "Sample scenario",
      predetermined: "Predetermined sample outcomes — not an evaluation of your case.",
      scen: ["Scenario A", "Scenario B", "Scenario C"],
      inputs: "Example inputs",
      rule: "Sample rule",
      ruleName: "Insured person status under the Social Security Act (illustrative)",
      date: "Relevant date",
      dateVal: "01 Oct 2026",
      jurisdiction: "Jurisdiction",
      thailand: "Thailand",
      conditions: "Conditions checked",
      result: "Result",
      why: "Why this result",
      factsUsed: "Facts used",
      matched: "Deciding condition",
      cited: "Cited source",
      version: "Rule version",
      versionVal: "SR-SSO-033 · v0.3 (sample)",
      missingInfo: "Missing information",
      none: "None for this scenario",
      source: "Social Security Act B.E. 2533 (1990) · Section 33",
      action: "Explore the rule example",
      actionPreview: "Request preview access",
      caption:
        "This example illustrates a rule evaluation. The result depends on the facts, scope and rule version used.",
      factLabels: ["Employer location", "Working arrangement", "Age of the person"],
      conds: [
        "Works for an employer in Thailand",
        "Employed under a contract of employment",
        "Age is within the range set by the Act",
      ],
      status: { met: "Met", no: "Not met", unk: "Cannot check" } as Record<"met" | "no" | "unk", string>,
      outcomes: {
        elig: "Eligible",
        not: "Not eligible",
        unk: "Insufficient information",
      } as Record<"elig" | "not" | "unk", string>,
      data: [
        {
          facts: ["Bangkok, Thailand", "Employee under an employment contract", "34"],
          kind: "elig" as const,
          st: ["met", "met", "met"] as ("met" | "no" | "unk")[],
          expl: "All three conditions are met by the supplied facts, so the sample rule returns Eligible.",
          decisive: "All conditions met",
          missing: "",
        },
        {
          facts: ["Bangkok, Thailand", "Independent contractor", "34"],
          kind: "not" as const,
          st: ["met", "no", "met"] as ("met" | "no" | "unk")[],
          expl: "The working arrangement does not meet the employment condition, so the sample rule returns Not eligible.",
          decisive: "Condition 2 — employed under a contract of employment",
          missing: "",
        },
        {
          facts: ["Bangkok, Thailand", "Employee under an employment contract", "Not provided"],
          kind: "unk" as const,
          st: ["met", "met", "unk"] as ("met" | "no" | "unk")[],
          expl: "The age condition cannot be checked without the person’s age. The rule does not guess — it asks for the missing fact.",
          decisive: "Condition 3 — cannot be checked",
          missing: "Age of the person",
        },
      ],
    },
    dev: {
      kicker: "Developers",
      h2: "Bring legal intelligence into the systems you use",
      intro:
        "For teams connecting REG24 information and capabilities to applications or AI assistants through supported API or MCP interfaces.",
      concepts: [
        { t: "API", d: "Request answers with their sources and dates from your own application." },
        { t: "MCP", d: "Let a connected AI assistant call REG24 as a tool, with references returned." },
        {
          t: "Traceable by design",
          d: "Responses carry source references, so your system can show the basis of each answer.",
        },
      ],
      enqH: "Interested in connecting REG24 to your system?",
      enqD: "Tell us about your use case to discuss access and integration.",
      discuss: "Discuss an integration",
      docs: "View developer documentation",
      avail: "Access by enquiry",
    },
    trust: {
      kicker: "Source and trust",
      h2: "Review the basis before using the answer",
      intro:
        "Facts, dates and source material affect interpretation. Review what supports an answer and whether its scope fits your work.",
      exampleLabel: "Example",
      cards: [
        {
          t: "Visible sources",
          d: "Inspect the document, issuing body and relevant reference.",
          ex: "Personal Data Protection Act B.E. 2562 · Section 23",
        },
        {
          t: "Relevant dates",
          d: "Check source dates and the time period used in the analysis.",
          ex: "In force · version checked 01 Oct 2026",
        },
        {
          t: "Missing information",
          d: "See follow up questions and conditions that could change the assessment.",
          ex: "Still needed: whether data is transferred outside Thailand",
        },
      ],
      coverage: "Explore supported coverage",
      scope:
        "REG24 supports research and preparation for review. Check that the findings fit the facts and context of your situation before using them.",
    },
    pricing: {
      kicker: "Pricing",
      h2: "Choose a plan that fits the way you work",
      intro: "Start with your needs, then compare the included usage and capabilities in each plan.",
      monthly: "Monthly",
      annual: "Annual",
      included: "Included in this plan",
      users: "Users",
      usage: "Included usage",
      limits: "Limits",
      priceTbd: "Price shown at launch",
      tbd: "Confirmed at launch",
      billedM: "Billed monthly. VAT treatment is shown before you confirm.",
      billedA: "Billed annually. The total charged is shown before you confirm.",
      trialNote:
        "Trial terms, included usage and what happens when the trial ends are shown before you confirm.",
      compare: "Compare all plans",
      contact: "Contact us",
      plans: [
        { n: "Individual", d: "For one person researching questions and reviewing sources.", users: "1 person" },
        { n: "Business", d: "For businesses using REG24 in their team workflows.", users: "Business workspace" },
        {
          n: "Professional",
          d: "For professionals researching issues and preparing work for review.",
          users: "Client workspaces, where supported",
        },
      ],
      ent: { n: "Enterprise", d: "Discuss organisation requirements, access and expected usage." },
    },
    faq: {
      kicker: "Questions",
      h2: "Questions before you start",
      items: [
        {
          q: "Who is REG24 for?",
          a: "REG24 is designed for business owners, legal and compliance teams, advisers and individuals researching legal questions and reviewing sources. Start with an example relevant to your work.",
        },
        {
          q: "Which legal topics does REG24 cover?",
          a: "Coverage depends on the available datasets and capabilities. Review the coverage page for supported topics, jurisdictions and time periods before starting your work.",
        },
        {
          q: "How can I check the basis of an answer?",
          a: "Open the sources to inspect the supporting material and references. Check that the details and relevant dates fit your situation.",
        },
        {
          q: "Does REG24 replace professional review?",
          a: "REG24 supports research, explanation and preparation for review. Complex or consequential matters should be reviewed by an appropriate professional before action.",
        },
        {
          q: "How do I start a trial, and what are its limits?",
          a: "Choose a plan to see the trial terms, included usage and what happens when the trial ends before you confirm. Review the pricing page for the current details.",
        },
        {
          q: "Can my team use REG24 or connect it to another system?",
          a: "Check the capabilities included in each plan. For organisation use or integrations, contact us to confirm supported options and access terms.",
        },
      ],
    },
    final: {
      h2: "Start with the question on your desk",
      body: "Explore how legal information, sources and review points can bring more clarity to your work.",
      primary: "Start free trial",
      team: "Planning to use REG24 with a team? Contact us.",
    },
    drawer: {
      source: "Source",
      issuer: "Issuing body",
      ref: "Reference",
      extract: "Approved extract",
      extractNote: "The source extract approved by the legal content owner appears here.",
      original: "Open original",
      originalNote: "Opens the official publication when a link is available.",
      close: "Close",
    },
    footer: {
      scope:
        "REG24 supports legal and regulatory research and preparation for review. It is not a law firm and does not provide legal advice.",
      lang: "Thai and English",
      tagline: "Legal data infrastructure",
      groups: [
        { h: "Product", l: ["Sample answer", "Law as Code", "Pricing", "Coverage"] },
        { h: "Solutions", l: ["Business", "Legal and advisory", "Compliance", "Individuals"] },
        { h: "Developers", l: ["API and MCP", "Discuss an integration"] },
        { h: "Company", l: ["About", "Contact"] },
        { h: "Legal", l: ["Terms", "Privacy", "Security"] },
      ],
    },
  },
  th: {
    nav: {
      product: "ผลิตภัณฑ์",
      useCases: "กรณีการใช้งาน",
      law: "Law as Code",
      pricing: "ราคา",
      developers: "นักพัฒนา",
      signIn: "เข้าสู่ระบบ",
      trial: "เริ่มทดลองใช้ฟรี",
      workspace: "เปิดพื้นที่ทำงาน",
      menu: "เมนู",
    },
    hero: {
      eyebrow: "ข้อมูลอัจฉริยะด้านกฎหมายไทย สำหรับนักกฎหมายและระบบ AI",
      taglines: [
        {
          a: "ชั้นข้อมูลอัจฉริยะด้านกฎหมาย",
          b: "สำหรับนักกฎหมายในยุค AI",
          hook: "AI ร่างบันทึกได้ในไม่กี่วินาที REG24 บอกคุณว่าคำตอบนั้นยืนอยู่บนกฎหมายไทยฉบับใด มาตราใด",
        },
        {
          a: "AI ตอบได้เร็ว",
          b: "REG24 ตอบพร้อมที่มา",
          hook: "ทุกคำตอบมาพร้อมมาตรา หน่วยงานที่ออก และวันที่ตรวจสอบ",
        },
        {
          a: "กฎหมายที่เครื่องอ่านได้",
          b: "งานกฎหมายที่คมขึ้น",
          hook: "กฎกลายเป็นเงื่อนไขที่ตรวจสอบได้ คุณจึงเห็นว่าข้อเท็จจริงใดนำไปสู่ผลลัพธ์ใด",
        },
      ],
      sub: "REG24 เชื่อมกฎหมายเข้ากับงานของคุณ ค้นหาข้อกำหนดที่เกี่ยวข้อง อธิบายเป็นภาษาที่เข้าใจง่าย และระบุที่มาของทุกคำตอบ สำหรับนักกฎหมาย ที่ปรึกษา ทีมกำกับดูแล และเครื่องมือ AI ที่พวกเขาใช้",
      primary: "เริ่มทดลองใช้ฟรี",
      secondary: "ดูตัวอย่างคำตอบ",
      support: "เริ่มจากตัวอย่าง แล้วค่อยถามเรื่องของคุณ",
      scopeLabel: "ขอบเขต",
      scope:
        "ข้อมูลกฎหมายองค์กร การค้า และการกำกับดูแลของไทย ปัจจุบัน 38 กฎหมาย ใน 19 อุตสาหกรรม REG24 ช่วยค้นคว้าและเตรียมประเด็นประกอบการพิจารณา ไม่ได้ใช้แทนคำปรึกษาจากผู้เชี่ยวชาญ",
      scopeLink: "ดูขอบเขตข้อมูลที่รองรับ",
    },
    ui: {
      sample: "ตัวอย่าง",
      sampleAnswer: "ตัวอย่างคำตอบ",
      question: "คำถาม",
      keyPoints: "สรุปประเด็น",
      summary: "สรุป",
      sources: "แหล่งอ้างอิง",
      dates: "วันที่เกี่ยวข้อง",
      missing: "ข้อมูลที่ยังต้องทราบ",
      next: "ขั้นตอนถัดไป",
      askMine: "ถามเรื่องของฉัน",
      openSource: "เปิดแหล่งอ้างอิง",
      ready: "พร้อมถามเรื่องของคุณแล้วหรือยัง",
      loading: "กำลังเปิดตัวอย่าง",
      error: "เปิดตัวอย่างไม่สำเร็จ ลองอีกครั้ง",
      retry: "ลองอีกครั้ง",
      sampleNote:
        "ตัวอย่างที่คัดสรร คำถาม คำตอบ แหล่งอ้างอิง และวันที่ ผ่านการอนุมัติจากผู้ดูแลเนื้อหากฎหมายของ REG24",
      workspace: "ค้นคว้า",
      scope: "ประเทศไทย · กฎหมายปัจจุบัน",
      qa1: "ค้นข้อหารือสรรพากร",
      qa2: "ค้นคำพิพากษาฎีกา",
    },
    stats: {
      h2: "เชื่อมโยงกฎหมายไทย ตรวจที่มาได้ทุกคำตอบ",
      body: "ทุกคำตอบอ้างอิงกลับไปยังตัวบทกฎหมายต้นทาง คุณจึงตรวจสอบได้ด้วยตัวเองทุกครั้ง",
      label: "ข้อมูลในระบบ REG24",
      note: "ตัวเลขจากสถานะระบบล่าสุด · MCP 2026-07-28",
      items: [
        { n: "38", l: "กฎหมายไทยในระบบ" },
        { n: "19", l: "อุตสาหกรรมที่ครอบคลุม" },
        { n: "3,995", l: "จุดเชื่อมโยงในกราฟความรู้กฎหมาย" },
        { n: "9/9", l: "ผ่านเกณฑ์คุณภาพก่อนเผยแพร่" },
      ],
    },
    sampleSec: {
      kicker: "ดูตัวอย่างคำตอบ",
      h2a: "คำตอบที่อ่านเข้าใจ",
      h2b: "พร้อมที่มาให้ตรวจสอบ",
      intro:
        "ดูตัวอย่างว่าคำถามทางธุรกิจเชื่อมกับข้อกำหนด แหล่งอ้างอิง และประเด็นที่ต้องตรวจสอบต่ออย่างไร",
    },
    samples: [
      {
        q: "บทบัญญัติใดใน PDPA กำกับการแจ้งเจ้าของข้อมูลและฐานทางกฎหมาย เมื่อลูกความเก็บข้อมูลลูกค้าทางออนไลน์",
        summary:
          "มาตรา 23 และ 24 เป็นหลัก ผู้ควบคุมข้อมูลต้องแจ้งเจ้าของข้อมูลก่อนหรือขณะเก็บ และทุกวัตถุประสงค์ต้องมีฐานทางกฎหมาย ความยินยอมเป็นเพียงฐานหนึ่ง มาตรา 37 กำหนดหน้าที่ด้านความปลอดภัยและหน้าที่อื่นของผู้ควบคุมข้อมูล ควรตรวจด้วยว่ามีการส่งข้อมูลไปต่างประเทศหรือไม่",
        points: [
          "กำหนดวัตถุประสงค์และฐานทางกฎหมายของข้อมูลแต่ละประเภท",
          "แจ้งเจ้าของข้อมูลว่าเก็บอะไร เพื่ออะไร และนานเท่าใด ก่อนหรือขณะเก็บข้อมูล",
          "จัดให้มีมาตรการรักษาความปลอดภัยที่เหมาะสมและทบทวนอย่างสม่ำเสมอ",
        ],
        sources: [
          {
            title: "พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562",
            issuer: "คณะกรรมการคุ้มครองข้อมูลส่วนบุคคล",
            ref: "มาตรา 23 · การแจ้งเจ้าของข้อมูล",
            extract:
              "มาตรา 23 ในการเก็บรวบรวมข้อมูลส่วนบุคคล ผู้ควบคุมข้อมูลส่วนบุคคลต้องแจ้งให้เจ้าของข้อมูลส่วนบุคคลทราบก่อนหรือในขณะเก็บรวบรวมข้อมูลส่วนบุคคล ถึงวัตถุประสงค์ของการเก็บรวบรวม ระยะเวลาในการเก็บรวบรวม สิทธิของเจ้าของข้อมูลส่วนบุคคล และข้อมูลเกี่ยวกับผู้ควบคุมข้อมูลส่วนบุคคล",
          },
          {
            title: "พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562",
            issuer: "คณะกรรมการคุ้มครองข้อมูลส่วนบุคคล",
            ref: "มาตรา 24 · ฐานในการเก็บรวบรวมข้อมูล",
            extract:
              "มาตรา 24 ห้ามมิให้ผู้ควบคุมข้อมูลส่วนบุคคลทำการเก็บรวบรวมข้อมูลส่วนบุคคลโดยไม่ได้รับความยินยอมจากเจ้าของข้อมูลส่วนบุคคล เว้นแต่เป็นการจำเป็นเพื่อการปฏิบัติตามสัญญา การปฏิบัติตามกฎหมาย ประโยชน์โดยชอบด้วยกฎหมาย หรือการป้องกันอันตรายต่อชีวิต",
          },
          {
            title: "พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562",
            issuer: "คณะกรรมการคุ้มครองข้อมูลส่วนบุคคล",
            ref: "มาตรา 37 · หน้าที่ของผู้ควบคุมข้อมูล",
            extract:
              "มาตรา 37 ผู้ควบคุมข้อมูลส่วนบุคคลมีหน้าที่จัดให้มีมาตรการรักษาความมั่นคงปลอดภัยที่เหมาะสม เพื่อป้องกันการสูญหาย เข้าถึง ใช้ เปลี่ยนแปลง แก้ไข หรือเปิดเผยข้อมูลส่วนบุคคลโดยปราศจากอำนาจหรือโดยมิชอบ",
          },
        ],
        dates: "มีผลใช้บังคับ · ตรวจฉบับล่าสุด 1 ต.ค. 2569",
        missing: [
          "ข้อมูลที่เก็บและเหตุผลในการเก็บ",
          "ใช้เครื่องมือของบุคคลภายนอก เช่น ระบบวิเคราะห์หรือระบบชำระเงินหรือไม่",
          "มีการส่งข้อมูลไปต่างประเทศหรือไม่",
        ],
        next: [
          "ทำรายการข้อมูลแต่ละประเภทและวัตถุประสงค์",
          "ร่างประกาศความเป็นส่วนตัว",
          "ตรวจสัญญากับผู้ประมวลผลข้อมูลภายนอก",
        ],
      },
      {
        q: "ก่อนจ้างพนักงานคนแรก ต้องเตรียมเรื่องใดบ้าง",
        summary:
          "ก่อนจ้างพนักงานคนแรก ควรกำหนดเงื่อนไขการจ้างเป็นลายลักษณ์อักษร ขึ้นทะเบียนกับสำนักงานประกันสังคม และเตรียมหักภาษี ณ ที่จ่ายจากค่าจ้าง หน้าที่บางข้อขึ้นอยู่กับจำนวนลูกจ้างและประเภทธุรกิจ",
        points: [
          "เงื่อนไขการจ้าง ทั้งค่าจ้าง เวลาทำงาน วันลา และการเลิกจ้าง ควรทำเป็นลายลักษณ์อักษรและไม่ต่ำกว่าที่กฎหมายกำหนด",
          "นายจ้างต้องขึ้นทะเบียนนายจ้างและลูกจ้างกับสำนักงานประกันสังคมภายในระยะเวลาที่กำหนด",
          "หักภาษีเงินได้บุคคลธรรมดาจากค่าจ้างและยื่นแบบเป็นรายเดือน",
        ],
        sources: [
          {
            title: "พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541",
            issuer: "กระทรวงแรงงาน",
            ref: "หมวด 1–3 · เงื่อนไขการจ้างทั่วไป",
            extract:
              "หมวด 1–3 กำหนดมาตรฐานขั้นต่ำเกี่ยวกับเวลาทำงานปกติ (ไม่เกิน 8 ชั่วโมงต่อวัน และ 48 ชั่วโมงต่อสัปดาห์) เวลาพัก วันหยุด วันลา และการคุ้มครองค่าจ้างตามกฎหมาย",
          },
          {
            title: "พระราชบัญญัติประกันสังคม พ.ศ. 2533",
            issuer: "สำนักงานประกันสังคม",
            ref: "มาตรา 34 · การขึ้นทะเบียนนายจ้าง",
            extract:
              "มาตรา 34 ให้นายจ้างซึ่งมีลูกจ้างตั้งแต่หนึ่งคนขึ้นไปยื่นแบบรายการแสดงสภาพการเป็นนายจ้างและขึ้นทะเบียนผู้ประกันตนต่อสำนักงานประกันสังคมภายในสามสิบวันนับแต่วันที่ลูกจ้างเข้าทำงาน",
          },
          {
            title: "ประมวลรัษฎากร",
            issuer: "กรมสรรพากร",
            ref: "มาตรา 50 · การหักภาษี ณ ที่จ่ายจากเงินได้จากการจ้างงาน",
            extract:
              "มาตรา 50(1) ในกรณีเงินได้พึงประเมินตามมาตรา 40(1) และ (2) ให้ผู้จ่ายเงินได้คำนวณหักภาษี ณ ที่จ่ายทุกคราวที่จ่าย และนำส่งภายใน 7 วันนับแต่วันสิ้นเดือนของเดือนที่จ่าย",
          },
        ],
        dates: "มีผลใช้บังคับ รวมฉบับแก้ไข · ตรวจฉบับล่าสุด 1 ต.ค. 2569",
        missing: [
          "วันเริ่มงานที่วางแผนไว้",
          "ตำแหน่งเป็นงานเต็มเวลา ไม่เต็มเวลา หรือมีกำหนดระยะเวลา",
          "จำนวนลูกจ้างที่คาดว่าจะมีใน 12 เดือนข้างหน้า",
        ],
        next: [
          "ร่างสัญญาจ้างตามเงื่อนไขข้างต้น",
          "เตรียมเอกสารขึ้นทะเบียนประกันสังคม",
          "ให้ผู้เชี่ยวชาญทบทวน หากตำแหน่งงานมีลักษณะพิเศษ",
        ],
      },
      {
        q: "ก่อนเปลี่ยนกรรมการบริษัท ต้องตรวจสอบขั้นตอนใดบ้าง",
        summary:
          "การเปลี่ยนกรรมการบริษัทจำกัดโดยทั่วไปต้องมีมติผู้ถือหุ้นที่ถูกต้องตามข้อบังคับของบริษัท แล้วจดทะเบียนการเปลี่ยนแปลงกับกรมพัฒนาธุรกิจการค้า การเปลี่ยนแปลงจะยกขึ้นต่อสู้บุคคลภายนอกได้เมื่อจดทะเบียนแล้ว",
        points: [
          "ตรวจข้อบังคับเรื่องการแต่งตั้งและถอดถอนกรรมการ",
          "จัดประชุมและบันทึกมติให้ถูกต้อง",
          "ยื่นจดทะเบียนการเปลี่ยนแปลงกรรมการ",
        ],
        sources: [
          {
            title: "ประมวลกฎหมายแพ่งและพาณิชย์",
            issuer: "ราชกิจจานุเบกษา",
            ref: "มาตรา 1151 · การแต่งตั้งกรรมการ",
            extract:
              "มาตรา 1151 อันผู้เป็นกรรมการนั้น เฉพาะแต่ที่ประชุมใหญ่เท่านั้นอาจจะตั้งหรือถอนได้",
          },
          {
            title: "ประมวลกฎหมายแพ่งและพาณิชย์",
            issuer: "ราชกิจจานุเบกษา",
            ref: "มาตรา 1157 · การจดทะเบียนกรรมการ",
            extract:
              "มาตรา 1157 เมื่อมีการเปลี่ยนแปลงกรรมการ ให้บริษัทนำความไปจดทะเบียนภายในสิบสี่วันนับแต่วันที่มีการเปลี่ยนแปลง",
          },
          {
            title: "การจดทะเบียนเปลี่ยนแปลงกรรมการ",
            issuer: "กรมพัฒนาธุรกิจการค้า",
            ref: "คู่มือการจดทะเบียน",
            extract:
              "คู่มือการจดทะเบียนแก้ไขเพิ่มเติมกรรมการ (แบบ บอจ.4): ให้กรรมการผู้มีอำนาจลงลายมือชื่อยื่นจดทะเบียนภายใน 14 วันนับแต่วันที่ที่ประชุมใหญ่มีมติ พร้อมสำเนาบัตรประจำตัวกรรมการเข้าใหม่",
          },
        ],
        dates: "มีผลใช้บังคับ รวมฉบับแก้ไข · ตรวจฉบับล่าสุด 1 ต.ค. 2569",
        missing: [
          "ประเภทบริษัท บริษัทจำกัดหรือบริษัทมหาชนจำกัด",
          "ข้อบังคับของบริษัทกำหนดเรื่องการแต่งตั้งกรรมการไว้อย่างไร",
          "อำนาจกรรมการผู้มีอำนาจลงนามเปลี่ยนแปลงด้วยหรือไม่",
        ],
        next: [
          "ตรวจข้อบังคับของบริษัท",
          "เตรียมมติที่ประชุมผู้ถือหุ้น",
          "ยื่นจดทะเบียนกับกรมพัฒนาธุรกิจการค้า",
        ],
      },
    ] as SampleItem[],
    outcomes: {
      kicker: "สิ่งที่คุณได้รับ",
      h2: "จากคำถามที่ซับซ้อน สู่ประเด็นที่ทำงานต่อได้",
      items: [
        {
          t: "ค้นหาข้อกำหนดที่เกี่ยวข้อง",
          d: "เริ่มจากสถานการณ์ของคุณ แล้วสำรวจประเด็นกฎหมายและกฎระเบียบที่ควรตรวจสอบ",
        },
        {
          t: "เข้าใจคำตอบและที่มา",
          d: "อ่านสรุปที่เป็นภาษาคน พร้อมเปิดดูแหล่งอ้างอิงเพื่อพิจารณารายละเอียด",
        },
        {
          t: "เห็นสิ่งที่ควรทำต่อ",
          d: "แยกสิ่งที่ทราบแล้ว ข้อมูลที่ยังขาด และขั้นตอนที่ควรตรวจสอบก่อนดำเนินการ",
        },
      ],
    },
    roles: {
      kicker: "กรณีการใช้งาน",
      h2: "เริ่มจากงานที่คุณต้องทำ",
      exampleLabel: "ตัวอย่างคำถาม",
      startLabel: "จุดเริ่มต้นที่แนะนำ",
      note: "ตัวเลือกนี้จะถูกเลือกไว้ให้เมื่อคุณสร้างบัญชี และเปลี่ยนได้ภายหลัง",
      items: [
        {
          name: "ฝ่ายกฎหมายและที่ปรึกษา",
          need: "เริ่มค้นคว้าประเด็น ตรวจที่มา และเตรียมประเด็นสำหรับการทบทวน",
          link: "ดูตัวอย่างการค้นคว้า",
          ex: "แหล่งอ้างอิงใดรองรับหน้าที่แจ้งเจ้าของข้อมูล เมื่อเก็บข้อมูลผ่านเว็บไซต์",
          start: "เปิดตัวอย่างการค้นคว้า และตรวจแหล่งอ้างอิงแต่ละรายการ",
        },
        {
          name: "เจ้าของธุรกิจและทีมงาน",
          need: "ทำความเข้าใจข้อกำหนดที่เกี่ยวข้องกับการดำเนินธุรกิจ",
          link: "เริ่มจากคำถามธุรกิจ",
          ex: "ก่อนจ้างพนักงานคนแรก ต้องเตรียมเรื่องใดบ้าง",
          start: "เปิดตัวอย่างคำถามธุรกิจ แล้วปรับข้อเท็จจริงให้ตรงกับธุรกิจของคุณ",
        },
        {
          name: "ทีมกำกับดูแลและองค์กร",
          need: "สำรวจข้อกำหนดที่เกี่ยวข้องกับงานและประเด็นที่ต้องติดตาม",
          link: "คุยเรื่องการใช้งานในทีม",
          ex: "เมื่อเปลี่ยนกรรมการบริษัท มีขั้นตอนใดที่ทีมต้องติดตาม",
          start: "คุยกับทีมงานเรื่องการเข้าถึงของทีมและขั้นตอนการทบทวน",
        },
        {
          name: "ผู้ใช้งานรายบุคคล",
          need: "เริ่มจากคำถามของคุณ และสำรวจแหล่งข้อมูลที่เกี่ยวข้อง",
          link: "เริ่มคำถามของฉัน",
          ex: "ก่อนเซ็นสัญญาจ้างงาน ควรตรวจสอบอะไรบ้าง",
          start: "เริ่มถามคำถามของคุณได้ทันที โดยไม่ต้องตั้งค่าเพิ่มเติม",
        },
      ],
    },
    how: {
      kicker: "วิธีการทำงาน",
      h2a: "เริ่มง่าย",
      h2b: "แล้วค่อยลงลึกเมื่อคุณต้องการ",
      steps: [
        {
          t: "เล่าเรื่องที่คุณต้องการทราบ",
          d: "พิมพ์คำถามหรือเลือกตัวอย่าง ระบุข้อเท็จจริงและช่วงเวลาที่เกี่ยวข้อง",
          ex: "“เราวางแผนจ้างพนักงานคนแรกในกรุงเทพฯ เดือนหน้า”",
        },
        {
          t: "อ่านคำอธิบายและตรวจแหล่งอ้างอิง",
          d: "ดูประเด็นสำคัญ พร้อมตรวจรายละเอียดจากแหล่งข้อมูลที่รองรับคำตอบ",
          ex: "พ.ร.บ.ประกันสังคม พ.ศ. 2533 · มาตรา 34",
        },
        {
          t: "เตรียมขั้นตอนต่อไป",
          d: "ดูข้อมูลที่ยังขาดและประเด็นที่ควรตรวจสอบ ก่อนนำไปใช้กับสถานการณ์จริง",
          ex: "ยังต้องทราบ: วันเริ่มงานที่วางแผนไว้",
        },
      ],
    },
    law: {
      kicker: "Law as Code",
      kickerPreview: "Law as Code พรีวิว",
      h2: "เห็นว่าเงื่อนไขข้อใด นำไปสู่ผลลัพธ์ใด",
      intro:
        "สำรวจตัวอย่างการแปลงข้อกำหนดเป็นเงื่อนไขที่ตรวจสอบได้ ดูว่าข้อมูลที่ใช้ เงื่อนไขที่ตรง และแหล่งอ้างอิง เชื่อมกันเป็นผลลัพธ์อย่างไร",
      scenarioLabel: "สถานการณ์ตัวอย่าง",
      predetermined: "ผลลัพธ์ตัวอย่างที่กำหนดไว้ล่วงหน้า ไม่ใช่การประเมินกรณีของคุณ",
      scen: ["สถานการณ์ A", "สถานการณ์ B", "สถานการณ์ C"],
      inputs: "ข้อมูลตัวอย่าง",
      rule: "กฎตัวอย่าง",
      ruleName: "สถานะผู้ประกันตนตาม พ.ร.บ.ประกันสังคม (เพื่อการอธิบาย)",
      date: "วันที่เกี่ยวข้อง",
      dateVal: "1 ต.ค. 2569",
      jurisdiction: "เขตอำนาจ",
      thailand: "ประเทศไทย",
      conditions: "เงื่อนไขที่ตรวจสอบ",
      result: "ผลลัพธ์",
      why: "เหตุผลของผลลัพธ์นี้",
      factsUsed: "ข้อมูลที่ใช้",
      matched: "เงื่อนไขที่ชี้ผล",
      cited: "แหล่งอ้างอิง",
      version: "รุ่นของกฎ",
      versionVal: "SR-SSO-033 · v0.3 (ตัวอย่าง)",
      missingInfo: "ข้อมูลที่ยังขาด",
      none: "ไม่มีสำหรับสถานการณ์นี้",
      source: "พ.ร.บ.ประกันสังคม พ.ศ. 2533 · มาตรา 33",
      action: "ดูตัวอย่างการตรวจเงื่อนไข",
      actionPreview: "ขอสิทธิ์ทดลองใช้ล่วงหน้า",
      caption:
        "ตัวอย่างนี้ใช้เพื่ออธิบายวิธีตรวจเงื่อนไข ผลลัพธ์ขึ้นอยู่กับข้อเท็จจริง ขอบเขต และรุ่นของกฎที่ใช้",
      factLabels: ["ที่ตั้งนายจ้าง", "รูปแบบการทำงาน", "อายุของบุคคล"],
      conds: [
        "ทำงานให้นายจ้างในประเทศไทย",
        "เป็นลูกจ้างตามสัญญาจ้างแรงงาน",
        "อายุอยู่ในช่วงที่กฎหมายกำหนด",
      ],
      status: { met: "ตรง", no: "ไม่ตรง", unk: "ตรวจไม่ได้" } as Record<"met" | "no" | "unk", string>,
      outcomes: {
        elig: "มีสิทธิ์",
        not: "ไม่มีสิทธิ์",
        unk: "ข้อมูลไม่เพียงพอ",
      } as Record<"elig" | "not" | "unk", string>,
      data: [
        {
          facts: ["กรุงเทพฯ ประเทศไทย", "ลูกจ้างตามสัญญาจ้างแรงงาน", "34"],
          kind: "elig" as const,
          st: ["met", "met", "met"] as ("met" | "no" | "unk")[],
          expl: "ข้อเท็จจริงที่ให้มาตรงกับเงื่อนไขทั้งสามข้อ กฎตัวอย่างจึงให้ผลว่ามีสิทธิ์",
          decisive: "ตรงทุกเงื่อนไข",
          missing: "",
        },
        {
          facts: ["กรุงเทพฯ ประเทศไทย", "ผู้รับจ้างอิสระ", "34"],
          kind: "not" as const,
          st: ["met", "no", "met"] as ("met" | "no" | "unk")[],
          expl: "รูปแบบการทำงานไม่ตรงกับเงื่อนไขการเป็นลูกจ้าง กฎตัวอย่างจึงให้ผลว่าไม่มีสิทธิ์",
          decisive: "เงื่อนไขที่ 2 — เป็นลูกจ้างตามสัญญาจ้างแรงงาน",
          missing: "",
        },
        {
          facts: ["กรุงเทพฯ ประเทศไทย", "ลูกจ้างตามสัญญาจ้างแรงงาน", "ไม่ได้ระบุ"],
          kind: "unk" as const,
          st: ["met", "met", "unk"] as ("met" | "no" | "unk")[],
          expl: "ตรวจเงื่อนไขเรื่องอายุไม่ได้หากไม่ทราบอายุของบุคคล กฎจะไม่คาดเดาแทน แต่จะขอข้อมูลที่ขาด",
          decisive: "เงื่อนไขที่ 3 — ตรวจไม่ได้",
          missing: "อายุของบุคคล",
        },
      ],
    },
    dev: {
      kicker: "นักพัฒนา",
      h2: "นำความรู้กฎหมายไปอยู่ในระบบที่คุณใช้งาน",
      intro:
        "สำหรับทีมที่ต้องการเชื่อมข้อมูลและความสามารถของ REG24 เข้ากับแอปพลิเคชันหรือผู้ช่วย AI ผ่าน API หรือ MCP ตามรูปแบบการเชื่อมต่อที่รองรับ",
      concepts: [
        { t: "API", d: "ขอคำตอบพร้อมแหล่งอ้างอิงและวันที่ จากแอปพลิเคชันของคุณ" },
        { t: "MCP", d: "ให้ผู้ช่วย AI ที่เชื่อมต่อเรียกใช้ REG24 เป็นเครื่องมือ พร้อมส่งแหล่งอ้างอิงกลับมา" },
        {
          t: "ตรวจสอบที่มาได้",
          d: "คำตอบมีแหล่งอ้างอิงแนบมา ระบบของคุณจึงแสดงที่มาของแต่ละคำตอบได้",
        },
      ],
      enqH: "สนใจเชื่อม REG24 กับระบบของคุณ",
      enqD: "แจ้งรูปแบบการใช้งานที่ต้องการ เพื่อพูดคุยเรื่องการเข้าถึงและการเชื่อมต่อ",
      discuss: "ติดต่อเรื่องการเชื่อมต่อ",
      docs: "ดูเอกสารสำหรับนักพัฒนา",
      avail: "เปิดให้ใช้งานตามคำขอ",
    },
    trust: {
      kicker: "แหล่งที่มาและความน่าเชื่อถือ",
      h2: "ตรวจที่มาได้ ก่อนนำคำตอบไปใช้",
      intro:
        "ข้อเท็จจริง ช่วงเวลา และแหล่งข้อมูลมีผลต่อการตีความ เปิดดูสิ่งที่รองรับคำตอบ และตรวจว่าขอบเขตตรงกับงานของคุณหรือไม่",
      exampleLabel: "ตัวอย่าง",
      cards: [
        {
          t: "แหล่งอ้างอิงชัดเจน",
          d: "ดูชื่อเอกสาร หน่วยงาน และจุดอ้างอิงที่เกี่ยวข้อง",
          ex: "พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 · มาตรา 23",
        },
        {
          t: "มองเห็นช่วงเวลาที่เกี่ยวข้อง",
          d: "ตรวจวันที่ของแหล่งข้อมูลและช่วงเวลาที่ใช้พิจารณา",
          ex: "มีผลใช้บังคับ · ตรวจฉบับล่าสุด 1 ต.ค. 2569",
        },
        {
          t: "รู้ว่าข้อมูลใดยังขาด",
          d: "เห็นคำถามเพิ่มเติมและเงื่อนไขที่อาจเปลี่ยนผลการพิจารณา",
          ex: "ยังต้องทราบ: มีการส่งข้อมูลไปต่างประเทศหรือไม่",
        },
      ],
      coverage: "ดูขอบเขตข้อมูลที่รองรับ",
      scope:
        "REG24 ช่วยค้นคว้าและเตรียมประเด็นประกอบการพิจารณา การนำไปใช้ควรตรวจสอบให้ตรงกับข้อเท็จจริงและบริบทของแต่ละเรื่อง",
    },
    pricing: {
      kicker: "ราคา",
      h2: "เลือกแผนให้เหมาะกับวิธีทำงานของคุณ",
      intro: "เริ่มจากการใช้งานของคุณ แล้วเปรียบเทียบปริมาณการใช้งานและความสามารถที่รวมในแต่ละแผน",
      monthly: "รายเดือน",
      annual: "รายปี",
      included: "สิ่งที่รวมในแผน",
      users: "จำนวนผู้ใช้",
      usage: "ปริมาณการใช้งาน",
      limits: "ข้อจำกัด",
      priceTbd: "แสดงราคาเมื่อเปิดให้บริการ",
      tbd: "ยืนยันเมื่อเปิดให้บริการ",
      billedM: "เรียกเก็บรายเดือน แสดงการคิดภาษีมูลค่าเพิ่มก่อนคุณยืนยัน",
      billedA: "เรียกเก็บรายปี แสดงยอดรวมที่เรียกเก็บก่อนคุณยืนยัน",
      trialNote:
        "เงื่อนไขทดลองใช้ ปริมาณที่รวม และสิ่งที่เกิดขึ้นเมื่อสิ้นสุดช่วงทดลอง จะแสดงก่อนคุณยืนยัน",
      compare: "ดูรายละเอียดทุกแผน",
      contact: "ติดต่อทีมงาน",
      plans: [
        {
          n: "รายบุคคล",
          d: "สำหรับผู้ใช้งานคนเดียวที่ต้องการค้นคว้าประเด็นและตรวจแหล่งอ้างอิง",
          users: "1 คน",
        },
        {
          n: "ธุรกิจ",
          d: "สำหรับธุรกิจที่ต้องการใช้ REG24 กับงานประจำของทีม",
          users: "พื้นที่ทำงานของธุรกิจ",
        },
        {
          n: "มืออาชีพ",
          d: "สำหรับผู้เชี่ยวชาญที่ต้องการค้นคว้าและเตรียมงานสำหรับการทบทวน",
          users: "พื้นที่ทำงานลูกความ หากรองรับ",
        },
      ],
      ent: {
        n: "องค์กร",
        d: "พูดคุยเรื่องการใช้งานระดับองค์กร การเข้าถึง และปริมาณการใช้งานที่ต้องการ",
      },
    },
    faq: {
      kicker: "คำถามที่พบบ่อย",
      h2: "คำถามก่อนเริ่มใช้งาน",
      items: [
        {
          q: "REG24 เหมาะกับใคร",
          a: "เหมาะกับเจ้าของธุรกิจ ทีมกฎหมายและกำกับดูแล ที่ปรึกษา และผู้ใช้รายบุคคลที่ต้องการค้นคว้าประเด็นกฎหมายและตรวจแหล่งอ้างอิง เริ่มจากตัวอย่างที่ตรงกับงานของคุณได้",
        },
        {
          q: "REG24 ครอบคลุมกฎหมายด้านใดบ้าง",
          a: "ขอบเขตขึ้นอยู่กับชุดข้อมูลและความสามารถที่เปิดให้ใช้งาน ตรวจหัวข้อ เขตอำนาจ และข้อมูลช่วงเวลาที่รองรับจากหน้าขอบเขตข้อมูลก่อนเริ่มงาน",
        },
        {
          q: "ตรวจสอบที่มาของคำตอบได้อย่างไร",
          a: "เปิดส่วนแหล่งอ้างอิงเพื่อดูเอกสารและจุดอ้างอิงที่รองรับคำตอบ แล้วพิจารณาว่ารายละเอียดและวันที่เกี่ยวข้องตรงกับสถานการณ์ของคุณหรือไม่",
        },
        {
          q: "ใช้แทนการพิจารณาของผู้เชี่ยวชาญได้หรือไม่",
          a: "REG24 ช่วยค้นคว้า อธิบาย และเตรียมประเด็นให้ตรวจสอบ เรื่องที่มีความซับซ้อนหรือมีผลสำคัญควรได้รับการทบทวนโดยผู้เชี่ยวชาญที่เกี่ยวข้องก่อนดำเนินการ",
        },
        {
          q: "เริ่มทดลองใช้อย่างไร และมีข้อจำกัดอะไร",
          a: "เลือกแผนที่ต้องการ ระบบจะแสดงเงื่อนไขทดลองใช้ ปริมาณที่รวม และสิ่งที่จะเกิดขึ้นเมื่อสิ้นสุดช่วงทดลองก่อนคุณยืนยัน ตรวจรายละเอียดล่าสุดได้ที่หน้าราคา",
        },
        {
          q: "ใช้งานเป็นทีม หรือเชื่อมกับระบบอื่นได้หรือไม่",
          a: "ตรวจความสามารถที่รวมในแต่ละแผน หากต้องการใช้งานระดับองค์กรหรือเชื่อมระบบ ติดต่อทีมงานเพื่อยืนยันรูปแบบที่รองรับและเงื่อนไขการเข้าถึง",
        },
      ],
    },
    final: {
      h2: "เริ่มจากคำถามที่คุณกำลังเจอ",
      body: "ลองดูว่าข้อมูลกฎหมาย แหล่งอ้างอิง และประเด็นที่ต้องตรวจสอบต่อ จะช่วยให้งานของคุณชัดขึ้นได้อย่างไร",
      primary: "เริ่มทดลองใช้ฟรี",
      team: "ต้องการใช้งานเป็นทีม ติดต่อเรา",
    },
    drawer: {
      source: "แหล่งอ้างอิง",
      issuer: "หน่วยงานที่ออก",
      ref: "จุดอ้างอิง",
      extract: "ข้อความที่อนุมัติแล้ว",
      extractNote: "ข้อความจากแหล่งอ้างอิงที่ผู้ดูแลเนื้อหากฎหมายอนุมัติจะแสดงที่นี่",
      original: "เปิดต้นฉบับ",
      originalNote: "เปิดเอกสารทางการเมื่อมีลิงก์ให้ใช้งาน",
      close: "ปิด",
    },
    footer: {
      scope:
        "REG24 ช่วยค้นคว้าและเตรียมประเด็นด้านกฎหมายและกฎระเบียบประกอบการพิจารณา ไม่ใช่สำนักงานกฎหมาย และไม่ได้ให้คำปรึกษาทางกฎหมาย",
      lang: "ภาษาไทยและภาษาอังกฤษ",
      tagline: "โครงสร้างพื้นฐานข้อมูลกฎหมาย",
      groups: [
        { h: "ผลิตภัณฑ์", l: ["ตัวอย่างคำตอบ", "Law as Code", "ราคา", "ขอบเขตข้อมูล"] },
        { h: "โซลูชัน", l: ["ธุรกิจ", "กฎหมายและที่ปรึกษา", "กำกับดูแล", "รายบุคคล"] },
        { h: "นักพัฒนา", l: ["API และ MCP", "ติดต่อเรื่องการเชื่อมต่อ"] },
        { h: "บริษัท", l: ["เกี่ยวกับเรา", "ติดต่อเรา"] },
        { h: "กฎหมาย", l: ["ข้อกำหนดการใช้งาน", "นโยบายความเป็นส่วนตัว", "ความปลอดภัย"] },
      ],
    },
  },
};

export function Reg24LandingPage({
  defaultLang = "en",
  onLangChange,
  defaultVariant = "v3-paper",
  defaultTagline = "layer",
  signedIn = false,
  onOpenWorkspace,
}: Reg24LandingPageProps) {
  const [lang, setLangState] = useState<LandingLang>(defaultLang);
  const [variant, setVariant] = useState<LandingThemeVariant>(defaultVariant);
  const [tagline, setTagline] = useState<LandingTaglineVariant>(defaultTagline);
  const [w, setW] = useState<number>(1440);
  const [menu, setMenu] = useState<boolean>(false);
  const [sample, setSample] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [role, setRole] = useState<number>(0);
  const [scen, setScen] = useState<number>(0);
  const [why, setWhy] = useState<boolean>(false);
  const [billing, setBilling] = useState<"m" | "a">("m");
  const [faq, setFaq] = useState<number>(0);
  const [srcDrawer, setSrcDrawer] = useState<{ s: number; i: number; custom?: SourceItem & { dates?: string } } | null>(
    null
  );
  const [trialModal, setTrialModal] = useState<{
    open: boolean;
    mode: "trial" | "signin" | "enterprise" | "integration";
    selectedPlan?: string;
    email: string;
    org: string;
    submitted: boolean;
  }>({
    open: false,
    mode: "trial",
    selectedPlan: "Professional",
    email: "",
    org: "",
    submitted: false,
  });

  useEffect(() => {
    setLangState(defaultLang);
  }, [defaultLang]);

  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSrcDrawer(null);
        setMenu(false);
        setTrialModal((prev) => ({ ...prev, open: false }));
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const setLang = (next: LandingLang) => {
    setLangState(next);
    onLangChange?.(next);
  };

  const t = LANDING_T[lang] || LANDING_T.en;
  const isEn = lang === "en";
  const isTh = lang === "th";
  const lhH = lang === "th" ? 1.4 : 1.1;
  const lhD = lang === "th" ? 1.3 : 1.04;
  const narrow = w < 1040;
  const wide = !narrow;
  const statCols = w < 560 ? 2 : 4;

  const ink = "var(--color-text)";
  const paper = "var(--color-bg)";
  const sel = (on: boolean) => ({
    bg: on ? ink : "var(--color-surface)",
    fg: on ? paper : ink,
    bd: on ? ink : "transparent",
    pressed: on,
  });

  const pickSample = (idx: number) => {
    if (idx === sample) return;
    setSample(idx);
    setLoading(true);
    window.setTimeout(() => setLoading(false), 320);
  };

  const curSample = t.samples[sample] || t.samples[0];
  const h0 = t.samples[0];
  const taglineIndex = { layer: 0, sources: 1, machine: 2 }[tagline] ?? 0;
  const heroH = t.hero.taglines[taglineIndex] || t.hero.taglines[0];

  const L = t.law;
  const d = L.data[scen] || L.data[0];
  const stColor: Record<"met" | "no" | "unk", string> = {
    met: "var(--color-accent-700)",
    no: ink,
    unk: "color-mix(in srgb,var(--color-text) 72%,transparent)",
  };
  const badgeMap: Record<"elig" | "not" | "unk", [string, string, string]> = {
    elig: ["var(--color-accent)", "var(--reg-navy)", "var(--color-accent-500)"],
    not: ["transparent", ink, ink],
    unk: ["var(--color-bg)", ink, "var(--color-divider)"],
  };
  const badge = badgeMap[d.kind];

  const curRole = t.roles.items[role] || t.roles.items[0];
  const billedNote = billing === "m" ? t.pricing.billedM : t.pricing.billedA;

  const activeDrawerSource = srcDrawer
    ? srcDrawer.custom
      ? srcDrawer.custom
      : {
          ...(t.samples[srcDrawer.s]?.sources[srcDrawer.i] || h0.sources[0]),
          dates: t.samples[srcDrawer.s]?.dates || h0.dates,
        }
    : null;

  const rootVars: React.CSSProperties =
    variant === "v2-dark"
      ? ({
          "--reg-navy": "#0c111b",
          "--reg-lime": "#dbff1f",
          "--color-bg": "#0c111b",
          "--color-surface": "#141b27",
          "--color-text": "#eef1f5",
          "--color-divider": "color-mix(in srgb, #eef1f5 24%, transparent)",
          "--color-accent": "#dbff1f",
          "--color-accent-100": "#1b2208",
          "--color-accent-200": "#273109",
          "--color-accent-300": "#3d4d0c",
          "--color-accent-400": "#a6c416",
          "--color-accent-500": "#c8eb1c",
          "--color-accent-600": "#c6e81b",
          "--color-accent-700": "#d4f73a",
          "--color-accent-800": "#e9ff8a",
          "--color-accent-900": "#f4ffc4",
          "--font-heading": '"Archivo", "Noto Sans Thai", system-ui, sans-serif',
          "--font-heading-weight": 800,
          "--font-body": '"Archivo", "Noto Sans Thai", system-ui, sans-serif',
        } as React.CSSProperties)
      : variant === "v1-crimson"
      ? ({
          "--reg-navy": "#201e1d",
          "--reg-lime": "#e32035",
          "--color-bg": "#f3f2f2",
          "--color-surface": "#eae9e9",
          "--color-text": "#201e1d",
          "--color-divider": "color-mix(in srgb, #201e1d 40%, transparent)",
          "--color-accent": "#e32035",
          "--color-accent-100": "#fff1f2",
          "--color-accent-200": "#ffe0e3",
          "--color-accent-300": "#ffc2c8",
          "--color-accent-400": "#ff8f9a",
          "--color-accent-500": "#f2505f",
          "--color-accent-600": "#c81a2e",
          "--color-accent-700": "#a81022",
          "--color-accent-800": "#780f1c",
          "--color-accent-900": "#4a1117",
          "--font-heading": '"Archivo", "Noto Sans Thai", system-ui, sans-serif',
          "--font-heading-weight": 800,
          "--font-body": '"Archivo", "Noto Sans Thai", system-ui, sans-serif',
        } as React.CSSProperties)
      : ({
          "--reg-navy": "#0c111b",
          "--reg-lime": "#dbff1f",
          "--color-bg": "#f7f5ef",
          "--color-surface": "#ece8de",
          "--color-text": "#0c111b",
          "--color-divider": "color-mix(in srgb, #0c111b 24%, transparent)",
          "--color-accent": "#a8c43c",
          "--color-accent-100": "#f0f4df",
          "--color-accent-200": "#e0eabd",
          "--color-accent-300": "#c9da8c",
          "--color-accent-400": "#b6cd5f",
          "--color-accent-500": "#8fab2c",
          "--color-accent-600": "#97b22f",
          "--color-accent-700": "#4c6112",
          "--color-accent-800": "#39490c",
          "--color-accent-900": "#252f08",
          "--font-heading": '"Archivo", "Noto Sans Thai", system-ui, sans-serif',
          "--font-heading-weight": 800,
          "--font-body": '"Archivo", "Noto Sans Thai", system-ui, sans-serif',
        } as React.CSSProperties);

  const launchWorkspaceWithQuery = (qText?: string, targetNav: "research" | "workspace" | "documents" | "databases" | "mcp" | "developer" | "control" = "research") => {
    if (onOpenWorkspace) {
      onOpenWorkspace({ nav: targetNav, query: qText, roleIndex: role });
    }
  };

  return (
    <div
      lang={lang}
      className="reg24-landing-root"
      style={{
        ...rootVars,
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        fontSize: "16px",
        lineHeight: 1.65,
        minHeight: "100vh",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&family=Noto+Sans+Thai:wght@400;600;800&display=swap');
        .reg24-landing-root *, .reg24-landing-root *::before, .reg24-landing-root *::after {
          box-sizing: border-box;
        }
        .reg24-landing-root h1,
        .reg24-landing-root h2,
        .reg24-landing-root h3,
        .reg24-landing-root h4 {
          font-family: var(--font-heading);
          font-weight: 800;
        }
        .reg24-landing-root a {
          color: var(--color-accent-700);
          text-underline-offset: 3px;
        }
        .reg24-landing-root a:hover {
          color: var(--color-accent-800);
        }
        .reg24-landing-root .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          text-decoration: none;
          font-family: var(--font-heading);
          font-weight: 800;
          font-size: 14px;
          line-height: 1.2;
          color: var(--color-text);
          background: transparent;
          border: 1px solid transparent;
          padding: 8px 14.4px;
          border-radius: 0px;
        }
        .reg24-landing-root .btn svg {
          display: block;
        }
        .reg24-landing-root .btn-primary {
          background: var(--color-accent);
          color: var(--reg-navy);
        }
        .reg24-landing-root .btn-primary:hover {
          background: var(--color-accent-600);
          color: var(--reg-navy);
        }
        .reg24-landing-root .btn-primary:active {
          background: var(--color-accent-500);
        }
        .reg24-landing-root .btn-secondary {
          border-color: var(--color-divider);
          color: var(--color-text);
        }
        .reg24-landing-root .btn-secondary:hover {
          background: color-mix(in srgb, var(--color-text) 7%, transparent);
          color: var(--color-text);
        }
        .reg24-landing-root .btn-ghost {
          color: var(--color-accent-700);
          padding-inline: 4px;
        }
        .reg24-landing-root .btn-ghost:hover {
          background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        }
        .reg24-landing-root .btn-icon {
          width: 36px;
          height: 36px;
          padding: 0;
        }
        .reg24-landing-root .seg {
          display: inline-flex;
          overflow: hidden;
          border: 1px solid var(--color-divider);
          border-radius: 0px;
        }
        .reg24-landing-root .seg-opt {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          font-size: 13px;
          cursor: pointer;
          user-select: none;
        }
        .reg24-landing-root .seg-opt + .seg-opt {
          border-left: 1px solid var(--color-divider);
        }
        .reg24-landing-root .seg-opt input {
          position: absolute;
          opacity: 0;
          width: 0;
          height: 0;
          pointer-events: none;
        }
        .reg24-landing-root .seg-opt.is-active {
          background: var(--color-accent);
          color: var(--reg-navy);
        }
        .reg24-landing-root .seg-opt:not(.is-active):hover {
          background: color-mix(in srgb, var(--color-text) 7%, transparent);
        }
        .reg24-landing-root .tag {
          display: inline-flex;
          align-items: center;
          font-size: 11px;
          letter-spacing: 0.02em;
          padding: 3px 10px;
          border-radius: 0px;
        }
        .reg24-landing-root .tag-accent {
          background: var(--color-accent-100);
          color: var(--color-accent-800);
        }
        .reg24-landing-root .tag-outline {
          border: 1px solid var(--color-accent);
          color: var(--color-accent);
        }
        .reg24-landing-root .nav-link:hover {
          color: var(--color-accent) !important;
        }
        .reg24-landing-root .role-card:hover {
          outline: 1px solid var(--color-divider);
        }
      `}</style>

      {/* ════════════════════════════════════════════════════════════════════
          STICKY HEADER
          ════════════════════════════════════════════════════════════════════ */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "var(--color-bg)",
          borderBottom: "2px solid var(--color-divider)",
        }}
      >
        <div
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px)",
            height: "72px",
            display: "flex",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <a
            href="#top"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              textDecoration: "none",
              color: "var(--color-text)",
              marginRight: "auto",
            }}
          >
            {variant === "v1-crimson" ? (
              <span
                style={{
                  width: "12px",
                  height: "12px",
                  background: "var(--color-accent)",
                  flex: "none",
                }}
              />
            ) : (
              <span
                style={{
                  width: "30px",
                  height: "30px",
                  background: "var(--reg-lime)",
                  color: "var(--reg-navy)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: "13px",
                  letterSpacing: 0,
                  flex: "none",
                }}
              >
                24
              </span>
            )}
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 800,
                fontSize: "22px",
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              REG24
            </span>
            {variant !== "v1-crimson" && (
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  background: "var(--color-accent-500)",
                  flex: "none",
                }}
              />
            )}
          </a>

          {wide && (
            <nav aria-label="Primary" style={{ display: "flex", gap: "24px", alignItems: "center" }}>
              <a
                href="#product"
                className="nav-link"
                style={{
                  color: "var(--color-text)",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {t.nav.product}
              </a>
              <a
                href="#use-cases"
                className="nav-link"
                style={{
                  color: "var(--color-text)",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {t.nav.useCases}
              </a>
              <a
                href="#law-as-code"
                className="nav-link"
                style={{
                  color: "var(--color-text)",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {t.nav.law}
              </a>
              <a
                href="#pricing"
                className="nav-link"
                style={{
                  color: "var(--color-text)",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {t.nav.pricing}
              </a>
              <a
                href="#developers"
                className="nav-link"
                style={{
                  color: "var(--color-text)",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {t.nav.developers}
              </a>
            </nav>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "auto" }}>
            {/* Theme variant switcher (v3 Paper / v2 Dark / v1) */}
            {wide && (
              <div className="seg" role="radiogroup" aria-label="Theme Variant">
                <label
                  className={`seg-opt ${variant === "v3-paper" ? "is-active" : ""}`}
                  style={{ minHeight: "36px", fontWeight: 600, padding: "6px 10px", fontSize: "12px" }}
                  title="v3 Paper Theme"
                >
                  <input
                    type="radio"
                    name="landing-variant"
                    checked={variant === "v3-paper"}
                    onChange={() => setVariant("v3-paper")}
                  />
                  Paper
                </label>
                <label
                  className={`seg-opt ${variant === "v2-dark" ? "is-active" : ""}`}
                  style={{ minHeight: "36px", fontWeight: 600, padding: "6px 10px", fontSize: "12px" }}
                  title="v2 Dark Navy Theme"
                >
                  <input
                    type="radio"
                    name="landing-variant"
                    checked={variant === "v2-dark"}
                    onChange={() => setVariant("v2-dark")}
                  />
                  Dark
                </label>
              </div>
            )}

            {/* TH / EN Segmented Radio */}
            <div className="seg" role="radiogroup" aria-label="Language">
              <label
                className={`seg-opt ${isTh ? "is-active" : ""}`}
                style={{ minHeight: "36px", fontWeight: 600 }}
              >
                <input type="radio" name="lang" checked={isTh} onChange={() => setLang("th")} />
                TH
              </label>
              <label
                className={`seg-opt ${isEn ? "is-active" : ""}`}
                style={{ minHeight: "36px", fontWeight: 600 }}
              >
                <input type="radio" name="lang" checked={isEn} onChange={() => setLang("en")} />
                EN
              </label>
            </div>

            {!signedIn && !narrow && (
              <button
                type="button"
                onClick={() => launchWorkspaceWithQuery(undefined, "research")}
                className="nav-link"
                style={{
                  color: "var(--color-text)",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  font: "600 14px var(--font-body)",
                  whiteSpace: "nowrap",
                  padding: "6px 8px",
                }}
              >
                {t.nav.workspace}
              </button>
            )}

            {!signedIn && !narrow && (
              <button
                type="button"
                onClick={() =>
                  setTrialModal({
                    open: true,
                    mode: "signin",
                    selectedPlan: "Professional",
                    email: "",
                    org: "",
                    submitted: false,
                  })
                }
                className="nav-link"
                style={{
                  color: "var(--color-text)",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  font: "600 14px var(--font-body)",
                  whiteSpace: "nowrap",
                  padding: "6px 4px",
                }}
              >
                {t.nav.signIn}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (signedIn) {
                  launchWorkspaceWithQuery(undefined, "research");
                } else {
                  setTrialModal({
                    open: true,
                    mode: "trial",
                    selectedPlan: "Professional",
                    email: "",
                    org: "",
                    submitted: false,
                  });
                }
              }}
              className="btn btn-primary"
              style={{
                minHeight: "44px",
                padding: "10px 16px",
                justifyContent: "flex-start",
                whiteSpace: "nowrap",
              }}
            >
              {signedIn ? t.nav.workspace : t.nav.trial}
            </button>

            {narrow && (
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                aria-label={t.nav.menu}
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
                style={{ width: "44px", height: "44px" }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2, strokeLinecap: "square" }}
                >
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {narrow && menu && (
          <nav
            aria-label="Primary Mobile"
            style={{
              borderTop: "2px solid var(--color-divider)",
              background: "var(--color-bg)",
              padding: "8px clamp(20px,4vw,48px) 20px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <a
              href="#product"
              onClick={() => setMenu(false)}
              style={{
                color: "var(--color-text)",
                textDecoration: "none",
                fontWeight: 600,
                padding: "12px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              {t.nav.product}
            </a>
            <a
              href="#use-cases"
              onClick={() => setMenu(false)}
              style={{
                color: "var(--color-text)",
                textDecoration: "none",
                fontWeight: 600,
                padding: "12px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              {t.nav.useCases}
            </a>
            <a
              href="#law-as-code"
              onClick={() => setMenu(false)}
              style={{
                color: "var(--color-text)",
                textDecoration: "none",
                fontWeight: 600,
                padding: "12px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              {t.nav.law}
            </a>
            <a
              href="#pricing"
              onClick={() => setMenu(false)}
              style={{
                color: "var(--color-text)",
                textDecoration: "none",
                fontWeight: 600,
                padding: "12px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              {t.nav.pricing}
            </a>
            <a
              href="#developers"
              onClick={() => setMenu(false)}
              style={{
                color: "var(--color-text)",
                textDecoration: "none",
                fontWeight: 600,
                padding: "12px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              {t.nav.developers}
            </a>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                launchWorkspaceWithQuery(undefined, "research");
              }}
              style={{
                color: "var(--color-text)",
                background: "transparent",
                border: 0,
                textAlign: "left",
                font: "600 16px var(--font-body)",
                padding: "12px 0",
                cursor: "pointer",
              }}
            >
              {t.nav.workspace}
            </button>
          </nav>
        )}
      </header>

      <main id="top">
        {/* ════════════════════════════════════════════════════════════════════
            01 HERO
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="product"
          data-screen-label="01 Hero"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "clamp(40px,7vw,96px) clamp(20px,4vw,48px) clamp(48px,7vw,96px)",
            scrollMarginTop: "72px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "clamp(40px,5vw,72px)",
              alignItems: "flex-start",
            }}
          >
            {/* Left column */}
            <div style={{ flex: "7 1 440px", minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginBottom: "24px",
                }}
              >
                <p
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.4,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: "var(--color-accent-700)",
                    margin: 0,
                  }}
                >
                  {t.hero.eyebrow}
                </p>
                {/* Tagline switcher */}
                <div className="seg" role="radiogroup" aria-label="Hero Tagline">
                  {(["layer", "sources", "machine"] as LandingTaglineVariant[]).map((tg, idx) => (
                    <label
                      key={tg}
                      className={`seg-opt ${tagline === tg ? "is-active" : ""}`}
                      style={{ minHeight: "28px", padding: "3px 8px", fontSize: "11px", fontWeight: 600 }}
                    >
                      <input
                        type="radio"
                        name="hero-tagline"
                        checked={tagline === tg}
                        onChange={() => setTagline(tg)}
                      />
                      0{idx + 1}
                    </label>
                  ))}
                </div>
              </div>

              <h1
                style={{
                  fontSize: "clamp(32px,4vw,54px)",
                  lineHeight: lhD,
                  letterSpacing: "-0.025em",
                  margin: "0 0 0 -0.04em",
                }}
              >
                <span style={{ display: "block" }}>{heroH.a}</span>
                <span style={{ display: "block" }}>{heroH.b}</span>
              </h1>

              <p
                style={{
                  display: "flex",
                  gap: "14px",
                  alignItems: "flex-start",
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: "clamp(16px,1.3vw,18px)",
                  lineHeight: 1.45,
                  letterSpacing: "-0.005em",
                  maxWidth: "40ch",
                  margin: "28px 0 0",
                  paddingTop: "16px",
                  borderTop: "2px solid var(--color-divider)",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    background: "var(--color-accent-500)",
                    flex: "none",
                    marginTop: "0.55em",
                  }}
                />
                <span>{heroH.hook}</span>
              </p>

              <p
                style={{
                  fontSize: "15px",
                  lineHeight: 1.7,
                  maxWidth: "50ch",
                  margin: "16px 0 0",
                  color: "color-mix(in srgb,var(--color-text) 80%,transparent)",
                }}
              >
                {t.hero.sub}
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "32px" }}>
                <button
                  type="button"
                  onClick={() => launchWorkspaceWithQuery(undefined, "research")}
                  className="btn btn-primary"
                  style={{
                    minHeight: "44px",
                    padding: "11px 18px",
                    fontSize: "14px",
                    justifyContent: "flex-start",
                    gap: "10px",
                  }}
                >
                  {t.hero.primary}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
                <a
                  href="#sample"
                  className="btn btn-secondary"
                  style={{
                    minHeight: "44px",
                    padding: "11px 18px",
                    fontSize: "14px",
                    justifyContent: "flex-start",
                  }}
                >
                  {t.hero.secondary}
                </a>
              </div>

              <p
                style={{
                  fontSize: "14px",
                  margin: "14px 0 0",
                  color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                }}
              >
                {t.hero.support}
              </p>

              <div
                style={{
                  marginTop: "40px",
                  paddingTop: "14px",
                  borderTop: "2px solid var(--color-divider)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px 20px",
                  maxWidth: "560px",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    lineHeight: 1.9,
                  }}
                >
                  {t.hero.scopeLabel}
                </span>
                <p
                  style={{
                    flex: "1 1 320px",
                    margin: 0,
                    fontSize: "13px",
                    lineHeight: 1.6,
                    color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                  }}
                >
                  {t.hero.scope}{" "}
                  <a href="#coverage" style={{ fontWeight: 600 }}>
                    {t.hero.scopeLink}
                  </a>
                </p>
              </div>
            </div>

            {/* Right column — Dark Navy Live Engine + Sample Preview Card */}
            <div
              style={
                {
                  "--color-bg": "#0c111b",
                  "--color-surface": "#141b27",
                  "--color-text": "#eef1f5",
                  "--color-divider": "color-mix(in srgb,#eef1f5 24%,transparent)",
                  "--color-accent": "#dbff1f",
                  "--color-accent-600": "#c6e81b",
                  "--color-accent-100": "#1b2208",
                  "--color-accent-500": "#c8eb1c",
                  "--color-accent-700": "#d4f73a",
                  "--color-accent-800": "#e9ff8a",
                  flex: "5 1 340px",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "24px",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  padding: "clamp(20px,2.4vw,28px)",
                } as React.CSSProperties
              }
            >
              <div aria-label={t.stats.label}>
                <p
                  style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    fontSize: "12px",
                    lineHeight: 1.4,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: "var(--color-accent-700)",
                    margin: "0 0 10px",
                  }}
                >
                  <span style={{ width: "6px", height: "6px", background: "var(--color-accent)" }} />
                  {t.stats.label}
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${statCols},minmax(0,1fr))`,
                    gap: "0 16px",
                  }}
                >
                  {t.stats.items.map((sx, idx) => (
                    <div
                      key={idx}
                      style={{
                        borderTop: "2px solid var(--color-divider)",
                        padding: "12px 0 4px",
                      }}
                    >
                      <p
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "clamp(22px,1.9vw,28px)",
                          lineHeight: 1,
                          letterSpacing: "-0.02em",
                          color: "var(--color-accent)",
                          fontFeatureSettings: "'tnum' 1",
                          margin: 0,
                        }}
                      >
                        {sx.n}
                      </p>
                      <p
                        style={{
                          fontSize: "12px",
                          lineHeight: 1.4,
                          margin: "6px 0 0",
                          color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                        }}
                      >
                        {sx.l}
                      </p>
                    </div>
                  ))}
                </div>
                <p
                  style={{
                    fontFamily: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
                    fontSize: "11.5px",
                    margin: "10px 0 0",
                    color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                  }}
                >
                  {t.stats.note}
                </p>
              </div>

              <div style={{ background: "var(--color-surface)" }} aria-label={t.ui.sampleAnswer}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    padding: "12px 20px",
                    borderBottom: "2px solid var(--color-divider)",
                  }}
                >
                  <div style={{ display: "flex", gap: "6px" }}>
                    <span className="tag tag-accent" style={{ fontWeight: 800, letterSpacing: "0.06em" }}>
                      REG24
                    </span>
                    <span
                      className="tag"
                      style={{
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        background: "var(--color-bg)",
                        display: "flex",
                        gap: "6px",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ width: "6px", height: "6px", background: "var(--color-accent)" }} />
                      AI READY
                    </span>
                  </div>
                  <span className="tag tag-outline" style={{ fontWeight: 600 }}>
                    {t.ui.sample}
                  </span>
                </div>

                <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
                  <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-divider)" }}>
                    <p
                      style={{
                        fontSize: "14.5px",
                        fontWeight: 600,
                        lineHeight: 1.5,
                        margin: 0,
                        padding: "14px 16px 20px",
                      }}
                    >
                      {h0.q}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "8px 8px 8px 10px",
                        color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        style={{ strokeWidth: 2, margin: "0 5px" }}
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        style={{ strokeWidth: 2, margin: "0 5px" }}
                      >
                        <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
                      </svg>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        style={{ strokeWidth: 2, margin: "0 5px" }}
                      >
                        <path d="m4 17 6-6-6-6M12 19h8" />
                      </svg>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        style={{ strokeWidth: 2, margin: "0 5px" }}
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: "12px",
                          whiteSpace: "nowrap",
                          paddingRight: "8px",
                        }}
                      >
                        {t.ui.scope}
                      </span>
                      <button
                        type="button"
                        onClick={() => launchWorkspaceWithQuery(h0.q, "research")}
                        title={t.ui.askMine}
                        style={{
                          width: "36px",
                          height: "36px",
                          flex: "none",
                          background: "var(--color-accent)",
                          color: "var(--color-bg)",
                          border: 0,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          style={{ strokeWidth: 2.5, strokeLinecap: "square" }}
                        >
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div>
                    <p
                      style={{
                        fontSize: "12px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        fontWeight: 600,
                        margin: "0 0 6px",
                        color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                      }}
                    >
                      {t.ui.keyPoints}
                    </p>
                    <p
                      style={{
                        fontSize: "14px",
                        lineHeight: 1.65,
                        margin: 0,
                        color: "color-mix(in srgb,var(--color-text) 85%,transparent)",
                      }}
                    >
                      {h0.summary}
                    </p>
                  </div>

                  <div
                    style={{
                      borderTop: "1px solid var(--color-divider)",
                      paddingTop: "14px",
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-start",
                    }}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      style={{ strokeWidth: 2, flex: "none", marginTop: "2px" }}
                    >
                      <path d="M14 2H6v20h12V6z" />
                      <path d="M14 2v4h4M8 13h8M8 17h8M8 9h2" />
                    </svg>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.4, margin: 0 }}>
                        {h0.sources[0].title}
                      </p>
                      <p
                        style={{
                          fontSize: "13px",
                          lineHeight: 1.5,
                          margin: "2px 0 0",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {h0.sources[0].issuer} · {h0.sources[0].ref}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setSrcDrawer({ s: 0, i: 0 })}
                      style={{ minHeight: "36px", whiteSpace: "nowrap", color: "var(--color-accent-700)" }}
                    >
                      {t.ui.openSource}
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "13.5px", lineHeight: 1.5 }}>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      style={{ strokeWidth: 2, flex: "none" }}
                    >
                      <path d="M3 5h18v16H3zM3 10h18M8 2v5M16 2v5" />
                    </svg>
                    <span>
                      <strong style={{ fontWeight: 600 }}>{t.ui.dates}</strong> — {h0.dates}
                    </span>
                  </div>
                </div>

                <div style={{ borderTop: "2px solid var(--color-divider)", padding: "14px 20px" }}>
                  <button
                    type="button"
                    onClick={() => launchWorkspaceWithQuery(h0.q, "research")}
                    className="btn btn-secondary"
                    style={{
                      width: "100%",
                      minHeight: "44px",
                      justifyContent: "flex-start",
                      gap: "10px",
                      color: "#eef1f5",
                      borderColor: "color-mix(in srgb,#eef1f5 24%,transparent)",
                    }}
                  >
                    {t.ui.askMine}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      style={{ strokeWidth: 2.25, strokeLinecap: "square", marginLeft: "auto" }}
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            02 SAMPLE ANSWER
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="sample"
          data-screen-label="02 Sample answer"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px)",
            scrollMarginTop: "72px",
          }}
        >
          <div style={{ borderTop: "2px solid var(--color-divider)", padding: "clamp(48px,7vw,96px) 0" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "20px 64px",
                alignItems: "flex-end",
                marginBottom: "40px",
              }}
            >
              <div style={{ flex: "1 1 440px", minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.4,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: "var(--color-accent-700)",
                    margin: "0 0 16px",
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span>02</span>
                  <span>{t.sampleSec.kicker}</span>
                </p>
                <h2
                  style={{
                    fontSize: "clamp(26px,2.6vw,36px)",
                    lineHeight: lhH,
                    letterSpacing: "-0.02em",
                    margin: 0,
                  }}
                >
                  <span style={{ display: "block" }}>{t.sampleSec.h2a}</span>
                  <span style={{ display: "block" }}>{t.sampleSec.h2b}</span>
                </h2>
              </div>
              <p
                style={{
                  flex: "1 1 320px",
                  margin: 0,
                  fontSize: "15.5px",
                  maxWidth: "48ch",
                  color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                }}
              >
                {t.sampleSec.intro}
              </p>
            </div>

            <div
              role="group"
              aria-label={t.ui.question}
              style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}
            >
              {t.samples.map((smp, idx) => {
                const c = sel(idx === sample);
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-pressed={c.pressed}
                    onClick={() => pickSample(idx)}
                    style={{
                      minHeight: "44px",
                      padding: "10px 16px",
                      font: "inherit",
                      fontSize: "14.5px",
                      fontWeight: 600,
                      lineHeight: 1.4,
                      textAlign: "left",
                      cursor: "pointer",
                      border: `1px solid ${c.bd}`,
                      background: c.bg,
                      color: c.fg,
                    }}
                  >
                    {smp.q}
                  </button>
                );
              })}
            </div>

            <div style={{ background: "var(--color-surface)" }}>
              {loading ? (
                <div
                  role="status"
                  style={{
                    minHeight: "440px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    padding: "32px",
                  }}
                >
                  <p style={{ fontWeight: 600, margin: 0 }}>{t.ui.loading}…</p>
                  <div
                    style={{
                      height: "28px",
                      width: "70%",
                      background: "color-mix(in srgb,var(--color-text) 8%,var(--color-surface))",
                    }}
                  />
                  <div
                    style={{
                      height: "16px",
                      width: "90%",
                      background: "color-mix(in srgb,var(--color-text) 8%,var(--color-surface))",
                    }}
                  />
                  <div
                    style={{
                      height: "16px",
                      width: "84%",
                      background: "color-mix(in srgb,var(--color-text) 8%,var(--color-surface))",
                    }}
                  />
                  <div
                    style={{
                      height: "16px",
                      width: "60%",
                      background: "color-mix(in srgb,var(--color-text) 8%,var(--color-surface))",
                    }}
                  />
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  <div
                    style={{
                      flex: "7 1 440px",
                      minWidth: 0,
                      padding: "clamp(24px,3vw,40px)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "28px",
                    }}
                  >
                    <div>
                      <span className="tag tag-accent" style={{ fontWeight: 600, marginBottom: "14px" }}>
                        {t.ui.sampleAnswer}
                      </span>
                      <h3
                        style={{
                          fontSize: "clamp(22px,2.2vw,28px)",
                          lineHeight: lhH,
                          letterSpacing: "-0.015em",
                          margin: 0,
                        }}
                      >
                        {curSample.q}
                      </h3>
                    </div>

                    <div>
                      <p
                        style={{
                          fontSize: "12px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          margin: "0 0 8px",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {t.ui.summary}
                      </p>
                      <p style={{ fontSize: "17px", lineHeight: 1.65, margin: 0, maxWidth: "60ch" }}>
                        {curSample.summary}
                      </p>
                    </div>

                    <div>
                      <p
                        style={{
                          fontSize: "12px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          margin: "0 0 10px",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {t.ui.keyPoints}
                      </p>
                      <ul
                        style={{
                          listStyle: "none",
                          margin: 0,
                          padding: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        {curSample.points.map((pt, idx) => (
                          <li
                            key={idx}
                            style={{
                              display: "flex",
                              gap: "14px",
                              alignItems: "flex-start",
                              fontSize: "15.5px",
                              lineHeight: 1.6,
                            }}
                          >
                            <span
                              style={{
                                width: "8px",
                                height: "8px",
                                background: "var(--color-accent-500)",
                                flex: "none",
                                marginTop: "0.62em",
                              }}
                            />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p
                        style={{
                          fontSize: "12px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          margin: "0 0 10px",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {t.ui.next}
                      </p>
                      <ol
                        style={{
                          listStyle: "none",
                          margin: 0,
                          padding: 0,
                          borderTop: "1px solid var(--color-divider)",
                        }}
                      >
                        {curSample.next.map((nText, idx) => (
                          <li
                            key={idx}
                            style={{
                              display: "flex",
                              gap: "16px",
                              padding: "10px 0",
                              borderBottom: "1px solid var(--color-divider)",
                              fontSize: "15.5px",
                              lineHeight: 1.5,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 800,
                                fontFeatureSettings: "'tnum' 1",
                                minWidth: "24px",
                              }}
                            >
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <span>{nText}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>

                  {/* Right panel of Sample Answer */}
                  <div
                    style={{
                      flex: "5 1 320px",
                      minWidth: 0,
                      background: "color-mix(in srgb,var(--color-text) 4%,var(--color-surface))",
                      padding: "clamp(24px,3vw,40px)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "28px",
                    }}
                  >
                    <div>
                      <p
                        style={{
                          fontSize: "12px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          margin: "0 0 6px",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {t.ui.sources}
                      </p>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {curSample.sources.map((src, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setSrcDrawer({ s: sample, i: idx })}
                            style={{
                              display: "flex",
                              gap: "12px",
                              alignItems: "flex-start",
                              width: "100%",
                              textAlign: "left",
                              font: "inherit",
                              color: "inherit",
                              background: "transparent",
                              border: 0,
                              borderBottom: "1px solid var(--color-divider)",
                              padding: "14px 0",
                              cursor: "pointer",
                              minHeight: "44px",
                            }}
                          >
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              style={{ strokeWidth: 2, flex: "none", marginTop: "2px" }}
                            >
                              <path d="M14 2H6v20h12V6z" />
                              <path d="M14 2v4h4M8 13h8M8 17h8M8 9h2" />
                            </svg>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: "14.5px",
                                  fontWeight: 600,
                                  lineHeight: 1.4,
                                }}
                              >
                                {src.title}
                              </span>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: "13px",
                                  lineHeight: 1.5,
                                  marginTop: "2px",
                                  color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                                }}
                              >
                                {src.issuer} · {src.ref}
                              </span>
                            </span>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="var(--color-accent-700)"
                              style={{
                                strokeWidth: 2.25,
                                strokeLinecap: "square",
                                flex: "none",
                                marginTop: "4px",
                              }}
                            >
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p
                        style={{
                          fontSize: "12px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          margin: "0 0 8px",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {t.ui.dates}
                      </p>
                      <div
                        style={{
                          display: "flex",
                          gap: "12px",
                          alignItems: "flex-start",
                          fontSize: "14.5px",
                          lineHeight: 1.5,
                        }}
                      >
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          style={{ strokeWidth: 2, flex: "none" }}
                        >
                          <path d="M3 5h18v16H3zM3 10h18M8 2v5M16 2v5" />
                        </svg>
                        <span>{curSample.dates}</span>
                      </div>
                    </div>

                    <div>
                      <p
                        style={{
                          fontSize: "12px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          margin: "0 0 8px",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {t.ui.missing}
                      </p>
                      <ul
                        style={{
                          listStyle: "none",
                          margin: 0,
                          padding: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        {curSample.missing.map((m, idx) => (
                          <li
                            key={idx}
                            style={{
                              display: "flex",
                              gap: "12px",
                              alignItems: "flex-start",
                              fontSize: "14.5px",
                              lineHeight: 1.5,
                            }}
                          >
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="var(--color-accent-700)"
                              style={{ strokeWidth: 2, flex: "none" }}
                            >
                              <circle cx="12" cy="12" r="10" />
                              <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
                            </svg>
                            <span>{m}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div
                style={{
                  borderTop: "1px solid var(--color-divider)",
                  padding: "20px clamp(24px,3vw,40px)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "16px 32px",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: "1 1 360px", minWidth: 0 }}>
                  <p
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "20px",
                      lineHeight: 1.3,
                      margin: 0,
                    }}
                  >
                    {t.ui.ready}
                  </p>
                  <p
                    style={{
                      fontSize: "13px",
                      lineHeight: 1.5,
                      margin: "4px 0 0",
                      color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                    }}
                  >
                    {t.ui.sampleNote}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => launchWorkspaceWithQuery(curSample.q, "research")}
                  className="btn btn-primary"
                  style={{
                    minHeight: "48px",
                    padding: "12px 20px",
                    fontSize: "15px",
                    justifyContent: "flex-start",
                    gap: "12px",
                  }}
                >
                  {t.ui.askMine}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            03 OUTCOMES
            ════════════════════════════════════════════════════════════════════ */}
        <section
          data-screen-label="03 Outcomes"
          style={{ maxWidth: "1296px", margin: "0 auto", padding: "0 clamp(20px,4vw,48px)" }}
        >
          <div style={{ borderTop: "2px solid var(--color-divider)", padding: "clamp(48px,7vw,96px) 0" }}>
            <p
              style={{
                fontSize: "13px",
                lineHeight: 1.4,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "var(--color-accent-700)",
                margin: "0 0 16px",
                display: "flex",
                gap: "12px",
              }}
            >
              <span>03</span>
              <span>{t.outcomes.kicker}</span>
            </p>
            <h2
              style={{
                fontSize: "clamp(26px,2.6vw,36px)",
                lineHeight: lhH,
                letterSpacing: "-0.02em",
                margin: "0 0 48px",
                maxWidth: "20ch",
              }}
            >
              {t.outcomes.h2}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))",
                gap: "32px",
              }}
            >
              {t.outcomes.items.map((o, idx) => (
                <div
                  key={idx}
                  style={{ borderTop: "2px solid var(--color-divider)", paddingTop: "20px" }}
                >
                  <p
                    style={{
                      fontSize: "14px",
                      fontWeight: 800,
                      color: "var(--color-accent-700)",
                      fontFeatureSettings: "'tnum' 1",
                      margin: "0 0 20px",
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </p>
                  <h3
                    style={{
                      fontSize: "19px",
                      lineHeight: lhH,
                      letterSpacing: "-0.01em",
                      margin: "0 0 10px",
                    }}
                  >
                    {o.t}
                  </h3>
                  <p
                    style={{
                      fontSize: "16px",
                      margin: 0,
                      maxWidth: "40ch",
                      color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                    }}
                  >
                    {o.d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            04 USE CASES
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="use-cases"
          data-screen-label="04 Use cases"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px)",
            scrollMarginTop: "72px",
          }}
        >
          <div style={{ borderTop: "2px solid var(--color-divider)", padding: "clamp(48px,7vw,96px) 0" }}>
            <p
              style={{
                fontSize: "13px",
                lineHeight: 1.4,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "var(--color-accent-700)",
                margin: "0 0 16px",
                display: "flex",
                gap: "12px",
              }}
            >
              <span>04</span>
              <span>{t.roles.kicker}</span>
            </p>
            <h2
              style={{
                fontSize: "clamp(26px,2.6vw,36px)",
                lineHeight: lhH,
                letterSpacing: "-0.02em",
                margin: "0 0 48px",
                maxWidth: "20ch",
              }}
            >
              {t.roles.h2}
            </h2>
            <div
              role="group"
              aria-label={t.roles.kicker}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))",
                gap: "12px",
              }}
            >
              {t.roles.items.map((r, idx) => {
                const c = sel(idx === role);
                const linkColor = idx === role ? paper : "var(--color-accent-700)";
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-pressed={c.pressed}
                    onClick={() => setRole(idx)}
                    className="role-card"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "10px",
                      textAlign: "left",
                      font: "inherit",
                      cursor: "pointer",
                      padding: "24px",
                      minHeight: "200px",
                      border: 0,
                      background: c.bg,
                      color: c.fg,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "19px",
                        lineHeight: 1.3,
                      }}
                    >
                      {r.name}
                    </span>
                    <span style={{ fontSize: "15px", lineHeight: 1.55, flex: 1 }}>{r.need}</span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "14px",
                        fontWeight: 600,
                        color: linkColor,
                      }}
                    >
                      {r.link}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        style={{ strokeWidth: 2.5, strokeLinecap: "square" }}
                      >
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: "12px",
                background: "var(--color-surface)",
                padding: "clamp(20px,3vw,32px)",
                display: "flex",
                flexWrap: "wrap",
                gap: "24px 48px",
                alignItems: "flex-end",
              }}
            >
              <div style={{ flex: "3 1 340px", minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "12px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    margin: "0 0 8px",
                    color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                  }}
                >
                  {t.roles.exampleLabel}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "20px",
                    lineHeight: 1.35,
                    margin: 0,
                  }}
                >
                  {curRole.ex}
                </p>
              </div>
              <div style={{ flex: "2 1 260px", minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "12px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    margin: "0 0 8px",
                    color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                  }}
                >
                  {t.roles.startLabel}
                </p>
                <p style={{ fontSize: "15.5px", lineHeight: 1.55, margin: 0 }}>{curRole.start}</p>
              </div>
              <button
                type="button"
                onClick={() => launchWorkspaceWithQuery(curRole.ex, "research")}
                className="btn btn-primary"
                style={{
                  minHeight: "48px",
                  padding: "12px 20px",
                  fontSize: "15px",
                  justifyContent: "flex-start",
                  gap: "12px",
                }}
              >
                {curRole.link}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <p
              style={{
                fontSize: "13.5px",
                margin: "14px 0 0",
                color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
              }}
            >
              {t.roles.note}
            </p>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            05 HOW IT WORKS
            ════════════════════════════════════════════════════════════════════ */}
        <section
          data-screen-label="05 How it works"
          style={{ maxWidth: "1296px", margin: "0 auto", padding: "0 clamp(20px,4vw,48px)" }}
        >
          <div style={{ borderTop: "2px solid var(--color-divider)", padding: "clamp(48px,7vw,96px) 0" }}>
            <p
              style={{
                fontSize: "13px",
                lineHeight: 1.4,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "var(--color-accent-700)",
                margin: "0 0 16px",
                display: "flex",
                gap: "12px",
              }}
            >
              <span>05</span>
              <span>{t.how.kicker}</span>
            </p>
            <h2
              style={{
                fontSize: "clamp(26px,2.6vw,36px)",
                lineHeight: lhH,
                letterSpacing: "-0.02em",
                margin: "0 0 48px",
              }}
            >
              <span style={{ display: "block" }}>{t.how.h2a}</span>
              <span style={{ display: "block" }}>{t.how.h2b}</span>
            </h2>
            <ol
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))",
                gap: "32px",
              }}
            >
              {t.how.steps.map((st, idx) => (
                <li
                  key={idx}
                  style={{
                    borderTop: "2px solid var(--color-divider)",
                    paddingTop: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "clamp(36px,3.4vw,48px)",
                      lineHeight: 1,
                      color: "var(--color-text)",
                      marginLeft: "-0.04em",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <h3
                    style={{
                      fontSize: "19px",
                      lineHeight: lhH,
                      letterSpacing: "-0.01em",
                      margin: "8px 0 0",
                    }}
                  >
                    {st.t}
                  </h3>
                  <p
                    style={{
                      fontSize: "16px",
                      margin: 0,
                      flex: 1,
                      color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                    }}
                  >
                    {st.d}
                  </p>
                  <div
                    style={{
                      background: "var(--color-surface)",
                      padding: "14px 16px",
                      fontSize: "14px",
                      lineHeight: 1.5,
                      display: "flex",
                      gap: "10px",
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        background: "var(--color-accent-500)",
                        flex: "none",
                        marginTop: "0.55em",
                      }}
                    />
                    <span>{st.ex}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            06 LAW AS CODE
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="law-as-code"
          data-screen-label="06 Law as Code"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px)",
            scrollMarginTop: "72px",
          }}
        >
          <div style={{ borderTop: "2px solid var(--color-divider)", padding: "clamp(48px,7vw,96px) 0" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "20px 64px",
                alignItems: "flex-end",
                marginBottom: "40px",
              }}
            >
              <div style={{ flex: "1 1 440px", minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.4,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: "var(--color-accent-700)",
                    margin: "0 0 16px",
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span>06</span>
                  <span>{L.kicker}</span>
                  <span
                    className="tag tag-accent"
                    style={{ letterSpacing: "0.02em", textTransform: "none", fontWeight: 600 }}
                  >
                    {t.ui.sample}
                  </span>
                </p>
                <h2
                  style={{
                    fontSize: "clamp(26px,2.6vw,36px)",
                    lineHeight: lhH,
                    letterSpacing: "-0.02em",
                    margin: 0,
                    maxWidth: "20ch",
                  }}
                >
                  {L.h2}
                </h2>
              </div>
              <p
                style={{
                  flex: "1 1 320px",
                  margin: 0,
                  fontSize: "15.5px",
                  maxWidth: "48ch",
                  color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                }}
              >
                {L.intro}
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "12px 20px",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {L.scenarioLabel}
              </span>
              <div className="seg" role="radiogroup" aria-label={L.scenarioLabel}>
                {L.scen.map((label, idx) => (
                  <label
                    key={idx}
                    className={`seg-opt ${scen === idx ? "is-active" : ""}`}
                    style={{ minHeight: "44px", padding: "8px 16px", fontSize: "14px", fontWeight: 600 }}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      checked={scen === idx}
                      onChange={() => setScen(idx)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <span
                style={{
                  fontSize: "13.5px",
                  color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                }}
              >
                {L.predetermined}
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              {/* Example inputs */}
              <div
                style={{
                  flex: "1 1 340px",
                  minWidth: 0,
                  background: "var(--color-surface)",
                  padding: "clamp(20px,3vw,32px)",
                }}
              >
                <p
                  style={{
                    fontSize: "12px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    margin: "0 0 8px",
                    color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                  }}
                >
                  {L.inputs}
                </p>
                <p style={{ fontSize: "13.5px", margin: 0 }}>{L.rule}</p>
                <p
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "18px",
                    lineHeight: 1.35,
                    margin: "2px 0 20px",
                  }}
                >
                  {L.ruleName}
                </p>
                <dl style={{ margin: 0, borderTop: "2px solid var(--color-divider)" }}>
                  {d.facts.map((val, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px 16px",
                        justifyContent: "space-between",
                        padding: "12px 0",
                        borderBottom: "1px solid var(--color-divider)",
                      }}
                    >
                      <dt
                        style={{
                          fontSize: "14px",
                          color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                        }}
                      >
                        {L.factLabels[idx]}
                      </dt>
                      <dd
                        style={{
                          margin: 0,
                          fontSize: "15.5px",
                          fontWeight: 600,
                          color: d.kind === "unk" && idx === 2 ? "var(--color-accent-700)" : ink,
                        }}
                      >
                        {val}
                      </dd>
                    </div>
                  ))}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px 16px",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderBottom: "1px solid var(--color-divider)",
                    }}
                  >
                    <dt
                      style={{
                        fontSize: "14px",
                        color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                      }}
                    >
                      {L.date}
                    </dt>
                    <dd style={{ margin: 0, fontSize: "15.5px", fontWeight: 600 }}>{L.dateVal}</dd>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px 16px",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderBottom: "1px solid var(--color-divider)",
                    }}
                  >
                    <dt
                      style={{
                        fontSize: "14px",
                        color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                      }}
                    >
                      {L.jurisdiction}
                    </dt>
                    <dd style={{ margin: 0, fontSize: "15.5px", fontWeight: 600 }}>{L.thailand}</dd>
                  </div>
                </dl>
              </div>

              {/* Rule Result */}
              <div
                style={{
                  flex: "1.3 1 400px",
                  minWidth: 0,
                  background: "color-mix(in srgb,var(--color-text) 4%,var(--color-surface))",
                  padding: "clamp(20px,3vw,32px)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      margin: "0 0 12px",
                      color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                    }}
                  >
                    {L.result}
                  </p>
                  <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                    <span
                      style={{
                        width: "48px",
                        height: "48px",
                        flex: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: badge[0],
                        color: badge[1],
                        border: `2px solid ${badge[2]}`,
                      }}
                    >
                      {d.kind === "elig" && (
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          style={{ strokeWidth: 2.5, strokeLinecap: "square" }}
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                      {d.kind === "not" && (
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          style={{ strokeWidth: 2.5, strokeLinecap: "square" }}
                        >
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      )}
                      {d.kind === "unk" && (
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          style={{ strokeWidth: 2.5, strokeLinecap: "square" }}
                        >
                          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17.5v.5" />
                        </svg>
                      )}
                    </span>
                    <p
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "clamp(26px,2.6vw,34px)",
                        lineHeight: 1.15,
                        letterSpacing: "-0.015em",
                        margin: 0,
                      }}
                    >
                      {L.outcomes[d.kind]}
                    </p>
                  </div>
                  <p style={{ fontSize: "15.5px", lineHeight: 1.6, margin: "14px 0 0" }}>{d.expl}</p>
                </div>

                <div>
                  <p
                    style={{
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      margin: "0 0 6px",
                      color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                    }}
                  >
                    {L.conditions}
                  </p>
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      borderTop: "1px solid var(--color-divider)",
                    }}
                  >
                    {L.conds.map((cText, idx) => {
                      const stKey = d.st[idx];
                      return (
                        <li
                          key={idx}
                          style={{
                            display: "flex",
                            gap: "12px",
                            alignItems: "flex-start",
                            padding: "10px 0",
                            borderBottom: "1px solid var(--color-divider)",
                            fontSize: "15px",
                            lineHeight: 1.5,
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 800,
                              fontFeatureSettings: "'tnum' 1",
                              minWidth: "20px",
                            }}
                          >
                            {idx + 1}
                          </span>
                          <span style={{ flex: 1 }}>{cText}</span>
                          <span
                            style={{
                              fontSize: "13px",
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              color: stColor[stKey],
                            }}
                          >
                            {L.status[stKey]}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSrcDrawer({
                      s: 1,
                      i: 1,
                      custom: {
                        title:
                          lang === "th"
                            ? "พระราชบัญญัติประกันสังคม พ.ศ. 2533"
                            : "Social Security Act B.E. 2533 (1990)",
                        issuer: lang === "th" ? "สำนักงานประกันสังคม" : "Social Security Office",
                        ref:
                          lang === "th"
                            ? "มาตรา 33 · ผู้ประกันตนซึ่งเป็นลูกจ้าง"
                            : "Section 33 · Insured Employees",
                        dates: L.dateVal,
                        extract:
                          lang === "th"
                            ? "มาตรา 33 ให้ลูกจ้างซึ่งมีอายุไม่ต่ำกว่าสิบห้าปีบริบูรณ์และไม่เกินหกสิบปีบริบูรณ์เป็นผู้ประกันตนตามพระราชบัญญัตินี้"
                            : "Section 33: An employee who is not less than fifteen years of age and not more than sixty years of age at the time of entry into employment shall be an insured person under this Act.",
                      },
                    })
                  }
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "center",
                    fontSize: "14.5px",
                    fontWeight: 600,
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--color-accent-700)",
                    textAlign: "left",
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    style={{ strokeWidth: 2, flex: "none" }}
                  >
                    <path d="M14 2H6v20h12V6z" />
                    <path d="M14 2v4h4M8 13h8M8 17h8" />
                  </svg>
                  {L.source}
                </button>

                <div style={{ borderTop: "2px solid var(--color-divider)", paddingTop: "16px" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-expanded={why}
                    onClick={() => setWhy(!why)}
                    style={{
                      minHeight: "44px",
                      padding: "10px 14px",
                      justifyContent: "flex-start",
                      gap: "10px",
                    }}
                  >
                    {L.why}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      style={{
                        strokeWidth: 2.5,
                        strokeLinecap: "square",
                        transform: `rotate(${why ? 180 : 0}deg)`,
                      }}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  {why && (
                    <dl
                      style={{
                        margin: "16px 0 0",
                        display: "grid",
                        gridTemplateColumns: "minmax(120px,auto) minmax(0,1fr)",
                        gap: "10px 20px",
                        fontSize: "14.5px",
                        lineHeight: 1.5,
                      }}
                    >
                      <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                        {L.factsUsed}
                      </dt>
                      <dd style={{ margin: 0 }}>
                        {d.facts.map((v, i) => `${L.factLabels[i]}: ${v}`).join(" · ")}
                      </dd>
                      <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                        {L.matched}
                      </dt>
                      <dd style={{ margin: 0 }}>{d.decisive}</dd>
                      <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                        {L.cited}
                      </dt>
                      <dd style={{ margin: 0 }}>{L.source}</dd>
                      <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                        {L.version}
                      </dt>
                      <dd style={{ margin: 0 }}>{L.versionVal}</dd>
                      <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                        {L.missingInfo}
                      </dt>
                      <dd style={{ margin: 0 }}>{d.missing || L.none}</dd>
                    </dl>
                  )}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "16px 32px",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: "20px",
              }}
            >
              <p
                style={{
                  flex: "1 1 380px",
                  margin: 0,
                  fontSize: "14px",
                  maxWidth: "70ch",
                  color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                }}
              >
                {L.caption}
              </p>
              <button
                type="button"
                onClick={() => launchWorkspaceWithQuery(L.source, "control")}
                className="btn btn-secondary"
                style={{
                  minHeight: "48px",
                  padding: "12px 20px",
                  fontSize: "15px",
                  justifyContent: "flex-start",
                  gap: "12px",
                }}
              >
                {L.action}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            07 DEVELOPERS
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="developers"
          data-screen-label="07 Developers"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px) clamp(48px,7vw,96px)",
            scrollMarginTop: "72px",
          }}
        >
          <div
            style={
              {
                "--color-bg": "#0c111b",
                "--color-surface": "#141b27",
                "--color-text": "#eef1f5",
                "--color-divider": "color-mix(in srgb,#eef1f5 24%,transparent)",
                "--color-accent": "#dbff1f",
                "--color-accent-600": "#c6e81b",
                "--color-accent-100": "#1b2208",
                "--color-accent-500": "#c8eb1c",
                "--color-accent-700": "#d4f73a",
                "--color-accent-800": "#e9ff8a",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                padding: "clamp(28px,5vw,64px)",
              } as React.CSSProperties
            }
          >
            <p
              style={{
                fontSize: "13px",
                lineHeight: 1.4,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "var(--color-accent-700)",
                margin: "0 0 16px",
                display: "flex",
                gap: "12px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span>07</span>
              <span>{t.dev.kicker}</span>
              <span
                className="tag"
                style={{
                  border: "1px solid var(--color-text)",
                  color: "var(--color-text)",
                  letterSpacing: "0.02em",
                  textTransform: "none",
                }}
              >
                {t.dev.avail}
              </span>
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "20px 64px",
                alignItems: "flex-end",
                marginBottom: "40px",
              }}
            >
              <h2
                style={{
                  flex: "1 1 440px",
                  minWidth: 0,
                  fontSize: "clamp(24px,2.4vw,34px)",
                  lineHeight: lhH,
                  letterSpacing: "-0.02em",
                  margin: 0,
                  maxWidth: "20ch",
                }}
              >
                {t.dev.h2}
              </h2>
              <p
                style={{
                  flex: "1 1 320px",
                  margin: 0,
                  fontSize: "15.5px",
                  maxWidth: "48ch",
                  color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                }}
              >
                {t.dev.intro}
              </p>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))",
                gap: "24px 32px",
              }}
            >
              {t.dev.concepts.map((dc, idx) => (
                <div
                  key={idx}
                  style={{ borderTop: "2px solid var(--color-divider)", paddingTop: "16px" }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "19px",
                      margin: "0 0 6px",
                    }}
                  >
                    {dc.t}
                  </p>
                  <p
                    style={{
                      fontSize: "15px",
                      lineHeight: 1.6,
                      margin: 0,
                      color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                    }}
                  >
                    {dc.d}
                  </p>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: "40px",
                paddingTop: "24px",
                borderTop: "2px solid var(--color-divider)",
                display: "flex",
                flexWrap: "wrap",
                gap: "16px 32px",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ flex: "1 1 360px", minWidth: 0 }}>
                <p
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "20px",
                    lineHeight: 1.35,
                    margin: 0,
                  }}
                >
                  {t.dev.enqH}
                </p>
                <p
                  style={{
                    fontSize: "15px",
                    margin: "4px 0 0",
                    color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                  }}
                >
                  {t.dev.enqD}
                </p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                <button
                  type="button"
                  onClick={() => launchWorkspaceWithQuery(undefined, "developer")}
                  className="btn btn-primary"
                  style={{
                    minHeight: "48px",
                    padding: "12px 20px",
                    fontSize: "15px",
                    justifyContent: "flex-start",
                    gap: "12px",
                    background: "#dbff1f",
                    color: "#0c111b",
                  }}
                >
                  {t.dev.docs}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => launchWorkspaceWithQuery(undefined, "mcp")}
                  className="btn"
                  style={{
                    minHeight: "48px",
                    padding: "12px 20px",
                    fontSize: "15px",
                    justifyContent: "flex-start",
                    color: "#eef1f5",
                    border: "2px solid #eef1f5",
                  }}
                >
                  {t.dev.discuss}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            08 TRUST AND COVERAGE
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="coverage"
          data-screen-label="08 Trust and coverage"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px)",
            scrollMarginTop: "72px",
          }}
        >
          <div style={{ borderTop: "2px solid var(--color-divider)", padding: "clamp(48px,7vw,96px) 0" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "20px 64px",
                alignItems: "flex-end",
                marginBottom: "48px",
              }}
            >
              <div style={{ flex: "1 1 440px", minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.4,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: "var(--color-accent-700)",
                    margin: "0 0 16px",
                    display: "flex",
                    gap: "12px",
                  }}
                >
                  <span>08</span>
                  <span>{t.trust.kicker}</span>
                </p>
                <h2
                  style={{
                    fontSize: "clamp(26px,2.6vw,36px)",
                    lineHeight: lhH,
                    letterSpacing: "-0.02em",
                    margin: 0,
                    maxWidth: "20ch",
                  }}
                >
                  {t.trust.h2}
                </h2>
              </div>
              <p
                style={{
                  flex: "1 1 320px",
                  margin: 0,
                  fontSize: "15.5px",
                  maxWidth: "48ch",
                  color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                }}
              >
                {t.trust.intro}
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))",
                gap: "32px",
              }}
            >
              {t.trust.cards.map((tc, idx) => (
                <div
                  key={idx}
                  style={{
                    borderTop: "2px solid var(--color-divider)",
                    paddingTop: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <h3 style={{ fontSize: "19px", lineHeight: lhH, letterSpacing: "-0.01em", margin: 0 }}>
                    {tc.t}
                  </h3>
                  <p
                    style={{
                      fontSize: "16px",
                      margin: 0,
                      flex: 1,
                      color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                    }}
                  >
                    {tc.d}
                  </p>
                  <div style={{ background: "var(--color-surface)", padding: "14px 16px", marginTop: "6px" }}>
                    <p
                      style={{
                        fontSize: "11.5px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        fontWeight: 600,
                        margin: "0 0 4px",
                        color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                      }}
                    >
                      {t.trust.exampleLabel}
                    </p>
                    <p style={{ fontSize: "14.5px", fontWeight: 600, lineHeight: 1.45, margin: 0 }}>{tc.ex}</p>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: "40px",
                background: "var(--color-surface)",
                padding: "20px clamp(20px,3vw,32px)",
                display: "flex",
                flexWrap: "wrap",
                gap: "16px 40px",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <p style={{ flex: "1 1 420px", margin: 0, fontSize: "16px", maxWidth: "72ch" }}>
                {t.trust.scope}
              </p>
              <button
                type="button"
                onClick={() => launchWorkspaceWithQuery(undefined, "databases")}
                className="btn btn-ghost"
                style={{
                  minHeight: "44px",
                  padding: "10px 8px",
                  fontSize: "15px",
                  justifyContent: "flex-start",
                  gap: "10px",
                  color: "var(--color-accent-700)",
                }}
              >
                {t.trust.coverage}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            09 PRICING
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="pricing"
          data-screen-label="09 Pricing"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px)",
            scrollMarginTop: "72px",
          }}
        >
          <div style={{ borderTop: "2px solid var(--color-divider)", padding: "clamp(48px,7vw,96px) 0" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "20px 64px",
                alignItems: "flex-end",
                marginBottom: "40px",
              }}
            >
              <div style={{ flex: "1 1 440px", minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.4,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: "var(--color-accent-700)",
                    margin: "0 0 16px",
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span>09</span>
                  <span>{t.pricing.kicker}</span>
                </p>
                <h2
                  style={{
                    fontSize: "clamp(26px,2.6vw,36px)",
                    lineHeight: lhH,
                    letterSpacing: "-0.02em",
                    margin: 0,
                    maxWidth: "20ch",
                  }}
                >
                  {t.pricing.h2}
                </h2>
              </div>
              <div
                style={{
                  flex: "1 1 320px",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  alignItems: "flex-start",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: "15.5px",
                    maxWidth: "48ch",
                    color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                  }}
                >
                  {t.pricing.intro}
                </p>
                <div className="seg" role="radiogroup" aria-label="Billing">
                  <label
                    className={`seg-opt ${billing === "m" ? "is-active" : ""}`}
                    style={{ minHeight: "44px", padding: "8px 18px", fontSize: "14px", fontWeight: 600 }}
                  >
                    <input
                      type="radio"
                      name="billing"
                      checked={billing === "m"}
                      onChange={() => setBilling("m")}
                    />
                    {t.pricing.monthly}
                  </label>
                  <label
                    className={`seg-opt ${billing === "a" ? "is-active" : ""}`}
                    style={{ minHeight: "44px", padding: "8px 18px", fontSize: "14px", fontWeight: 600 }}
                  >
                    <input
                      type="radio"
                      name="billing"
                      checked={billing === "a"}
                      onChange={() => setBilling("a")}
                    />
                    {t.pricing.annual}
                  </label>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
                gap: "12px",
              }}
            >
              {t.pricing.plans.map((pl, idx) => (
                <div
                  key={idx}
                  style={{
                    background: "var(--color-surface)",
                    padding: "clamp(20px,2.5vw,28px)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: "24px",
                        lineHeight: lhH,
                        letterSpacing: "-0.015em",
                        margin: "0 0 8px",
                      }}
                    >
                      {pl.n}
                    </h3>
                    <p
                      style={{
                        fontSize: "15.5px",
                        lineHeight: 1.55,
                        margin: 0,
                        color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
                      }}
                    >
                      {pl.d}
                    </p>
                  </div>
                  <div style={{ borderTop: "2px solid var(--color-divider)", paddingTop: "16px" }}>
                    <p
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "20px",
                        lineHeight: 1.3,
                        margin: 0,
                      }}
                    >
                      {t.pricing.priceTbd}
                    </p>
                    <p
                      style={{
                        fontSize: "13.5px",
                        lineHeight: 1.5,
                        margin: "4px 0 0",
                        color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                      }}
                    >
                      {billedNote}
                    </p>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p
                      style={{
                        fontSize: "12px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        fontWeight: 600,
                        margin: "0 0 6px",
                        color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                      }}
                    >
                      {t.pricing.included}
                    </p>
                    <dl style={{ margin: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "2px 16px",
                          justifyContent: "space-between",
                          padding: "10px 0",
                          borderBottom: "1px solid var(--color-divider)",
                          fontSize: "14.5px",
                        }}
                      >
                        <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                          {t.pricing.users}
                        </dt>
                        <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{pl.users}</dd>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "2px 16px",
                          justifyContent: "space-between",
                          padding: "10px 0",
                          borderBottom: "1px solid var(--color-divider)",
                          fontSize: "14.5px",
                        }}
                      >
                        <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                          {t.pricing.usage}
                        </dt>
                        <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{t.pricing.tbd}</dd>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "2px 16px",
                          justifyContent: "space-between",
                          padding: "10px 0",
                          borderBottom: "1px solid var(--color-divider)",
                          fontSize: "14.5px",
                        }}
                      >
                        <dt style={{ color: "color-mix(in srgb,var(--color-text) 72%,transparent)" }}>
                          {t.pricing.limits}
                        </dt>
                        <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{t.pricing.tbd}</dd>
                      </div>
                    </dl>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setTrialModal({
                        open: true,
                        mode: "trial",
                        selectedPlan: pl.n,
                        email: "",
                        org: "",
                        submitted: false,
                      })
                    }
                    className="btn btn-primary"
                    style={{
                      minHeight: "48px",
                      padding: "12px 18px",
                      fontSize: "15px",
                      justifyContent: "flex-start",
                      gap: "12px",
                    }}
                  >
                    {t.nav.trial}
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      style={{ strokeWidth: 2.25, strokeLinecap: "square", marginLeft: "auto" }}
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: "12px",
                borderTop: "2px solid var(--color-divider)",
                padding: "20px 0",
                display: "flex",
                flexWrap: "wrap",
                gap: "16px 40px",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  flex: "1 1 380px",
                  minWidth: 0,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px 24px",
                  alignItems: "baseline",
                }}
              >
                <h3 style={{ fontSize: "19px", lineHeight: lhH, margin: 0 }}>{t.pricing.ent.n}</h3>
                <p style={{ fontSize: "15.5px", margin: 0 }}>{t.pricing.ent.d}</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setTrialModal({
                    open: true,
                    mode: "enterprise",
                    selectedPlan: "Enterprise",
                    email: "",
                    org: "",
                    submitted: false,
                  })
                }
                className="btn btn-secondary"
                style={{
                  minHeight: "48px",
                  padding: "12px 20px",
                  fontSize: "15px",
                  justifyContent: "flex-start",
                }}
              >
                {t.pricing.contact}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "12px 32px",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: "20px",
              }}
            >
              <p
                style={{
                  flex: "1 1 380px",
                  margin: 0,
                  fontSize: "14px",
                  maxWidth: "70ch",
                  color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                }}
              >
                {t.pricing.trialNote}
              </p>
              <button
                type="button"
                onClick={() => launchWorkspaceWithQuery(undefined, "control")}
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  fontWeight: 600,
                  fontSize: "15px",
                  minHeight: "44px",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  color: "var(--color-accent-700)",
                }}
              >
                {t.pricing.compare}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            10 FAQ
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="faq"
          data-screen-label="10 FAQ"
          style={{
            maxWidth: "1296px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,48px)",
            scrollMarginTop: "72px",
          }}
        >
          <div
            style={{
              borderTop: "2px solid var(--color-divider)",
              padding: "clamp(48px,7vw,96px) 0",
              display: "flex",
              flexWrap: "wrap",
              gap: "32px 64px",
            }}
          >
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <p
                style={{
                  fontSize: "13px",
                  lineHeight: 1.4,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: "var(--color-accent-700)",
                  margin: "0 0 16px",
                  display: "flex",
                  gap: "12px",
                }}
              >
                <span>10</span>
                <span>{t.faq.kicker}</span>
              </p>
              <h2
                style={{
                  fontSize: "clamp(26px,2.6vw,36px)",
                  lineHeight: lhH,
                  letterSpacing: "-0.02em",
                  margin: 0,
                  maxWidth: "14ch",
                }}
              >
                {t.faq.h2}
              </h2>
            </div>
            <div style={{ flex: "2 1 520px", minWidth: 0, borderTop: "2px solid var(--color-divider)" }}>
              {t.faq.items.map((fq, idx) => {
                const isOpen = faq === idx;
                return (
                  <div
                    key={idx}
                    id={`faq-${idx + 1}`}
                    style={{
                      borderBottom: "1px solid var(--color-divider)",
                      scrollMarginTop: "80px",
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: "inherit" }}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`faq-a-${idx + 1}`}
                        onClick={() => setFaq(isOpen ? -1 : idx)}
                        style={{
                          width: "100%",
                          display: "flex",
                          gap: "20px",
                          alignItems: "center",
                          justifyContent: "space-between",
                          textAlign: "left",
                          font: "inherit",
                          color: "inherit",
                          background: "transparent",
                          border: 0,
                          cursor: "pointer",
                          padding: "20px 0",
                          minHeight: "64px",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-heading)",
                            fontWeight: 800,
                            fontSize: "18px",
                            lineHeight: 1.4,
                          }}
                        >
                          {fq.q}
                        </span>
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          style={{ strokeWidth: 2.5, strokeLinecap: "square", flex: "none" }}
                        >
                          <path d="M5 12h14" />
                          <path d={isOpen ? "M12 12h0" : "M12 5v14"} />
                        </svg>
                      </button>
                    </h3>
                    {isOpen && (
                      <p
                        id={`faq-a-${idx + 1}`}
                        style={{
                          margin: 0,
                          padding: "0 40px 24px 0",
                          fontSize: "16px",
                          maxWidth: "64ch",
                          color: "color-mix(in srgb,var(--color-text) 80%,transparent)",
                        }}
                      >
                        {fq.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════
            11 FINAL CTA
            ════════════════════════════════════════════════════════════════════ */}
        <section
          id="signup"
          data-screen-label="11 Final CTA"
          style={{
            background: "var(--color-accent)",
            color: "var(--reg-navy)",
            scrollMarginTop: "72px",
          }}
        >
          <div
            style={{
              maxWidth: "1296px",
              margin: "0 auto",
              padding: "clamp(56px,8vw,112px) clamp(20px,4vw,48px)",
            }}
          >
            <h2
              style={{
                fontSize: "clamp(30px,3.6vw,50px)",
                lineHeight: lhD,
                letterSpacing: "-0.025em",
                margin: "0 0 0 -0.04em",
                maxWidth: "16ch",
              }}
            >
              {t.final.h2}
            </h2>
            <p
              style={{
                fontSize: "17px",
                fontWeight: 600,
                lineHeight: 1.55,
                margin: "20px 0 0",
                maxWidth: "40ch",
              }}
            >
              {t.final.body}
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "16px 32px",
                alignItems: "center",
                marginTop: "40px",
              }}
            >
              <button
                type="button"
                onClick={() => launchWorkspaceWithQuery(undefined, "research")}
                className="btn"
                style={{
                  minHeight: "56px",
                  padding: "14px 22px",
                  fontSize: "17px",
                  justifyContent: "flex-start",
                  gap: "12px",
                  background: "var(--reg-navy)",
                  color: "#eef1f5",
                }}
              >
                {t.final.primary}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() =>
                  setTrialModal({
                    open: true,
                    mode: "enterprise",
                    selectedPlan: "Enterprise",
                    email: "",
                    org: "",
                    submitted: false,
                  })
                }
                style={{
                  color: "var(--reg-navy)",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  font: "600 20px var(--font-body)",
                  textDecoration: "underline",
                  textUnderlineOffset: "4px",
                  minHeight: "44px",
                  display: "flex",
                  alignItems: "center",
                  padding: 0,
                }}
              >
                {t.final.team}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ════════════════════════════════════════════════════════════════════
          FOOTER
          ════════════════════════════════════════════════════════════════════ */}
      <footer
        style={{
          maxWidth: "1296px",
          margin: "0 auto",
          padding: "clamp(48px,6vw,80px) clamp(20px,4vw,48px) 40px",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "40px 64px" }}>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <span
                style={{
                  width: "30px",
                  height: "30px",
                  background: "var(--reg-lime)",
                  color: "var(--reg-navy)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: "13px",
                  letterSpacing: 0,
                  flex: "none",
                }}
              >
                24
              </span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: "22px",
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                REG24
              </span>
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  background: "var(--color-accent-500)",
                  flex: "none",
                }}
              />
            </div>
            <p
              style={{
                fontSize: "14px",
                lineHeight: 1.6,
                margin: 0,
                maxWidth: "40ch",
                color: "color-mix(in srgb,var(--color-text) 76%,transparent)",
              }}
            >
              {t.footer.scope}
            </p>
            <button
              type="button"
              onClick={() => launchWorkspaceWithQuery(undefined, "databases")}
              style={{
                display: "inline-block",
                marginTop: "12px",
                fontSize: "14px",
                fontWeight: 600,
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                color: "var(--color-accent-700)",
                textDecoration: "underline",
              }}
            >
              {t.trust.coverage}
            </button>
          </div>

          <div
            style={{
              flex: "3 1 560px",
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
              gap: "32px 24px",
            }}
          >
            {t.footer.groups.map((g, gIdx) => (
              <div key={gIdx}>
                <p
                  style={{
                    fontSize: "12px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    margin: "0 0 12px",
                    paddingBottom: "10px",
                    borderBottom: "2px solid var(--color-divider)",
                  }}
                >
                  {g.h}
                </p>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {g.l.map((lk, lIdx) => (
                    <li key={lIdx}>
                      <a
                        href={
                          gIdx === 0 && lIdx === 0
                            ? "#sample"
                            : gIdx === 0 && lIdx === 1
                            ? "#law-as-code"
                            : gIdx === 0 && lIdx === 2
                            ? "#pricing"
                            : gIdx === 0 && lIdx === 3
                            ? "#coverage"
                            : gIdx === 2
                            ? "#developers"
                            : "#use-cases"
                        }
                        onClick={(e) => {
                          if (gIdx === 2 && lIdx === 0) {
                            e.preventDefault();
                            launchWorkspaceWithQuery(undefined, "mcp");
                          } else if (gIdx === 0 && lIdx === 3) {
                            e.preventDefault();
                            launchWorkspaceWithQuery(undefined, "databases");
                          }
                        }}
                        style={{
                          color: "var(--color-text)",
                          textDecoration: "none",
                          fontSize: "14.5px",
                          display: "inline-block",
                          padding: "3px 0",
                        }}
                      >
                        {lk}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: "48px",
            paddingTop: "16px",
            borderTop: "2px solid var(--color-divider)",
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 24px",
            justifyContent: "space-between",
            fontSize: "13px",
            color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
          }}
        >
          <span>© 2026 REG24 · {t.footer.tagline}</span>
          <span
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              fontFamily: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
              fontSize: "12px",
            }}
          >
            <span style={{ width: "6px", height: "6px", background: "var(--color-accent)" }} />
            MCP 2026-07-28 · graph 3,995 nodes · 38 laws · 19 industries
          </span>
          <span>{t.footer.lang}</span>
        </div>
      </footer>

      {/* ════════════════════════════════════════════════════════════════════
          PINPOINT SOURCE DRAWER
          ════════════════════════════════════════════════════════════════════ */}
      {activeDrawerSource && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            onClick={() => setSrcDrawer(null)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(12, 17, 27, 0.55)",
            }}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t.drawer.source}
            style={{
              position: "relative",
              width: "min(480px, 100%)",
              height: "100%",
              overflow: "auto",
              background: "var(--color-bg)",
              borderLeft: "2px solid var(--color-text)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 24px",
                borderBottom: "2px solid var(--color-divider)",
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: "var(--color-accent-700)",
                }}
              >
                {t.drawer.source}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                aria-label={t.drawer.close}
                onClick={() => setSrcDrawer(null)}
                style={{ width: "44px", height: "44px" }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div
              style={{
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "24px",
                flex: 1,
              }}
            >
              <h3
                style={{
                  fontSize: "26px",
                  lineHeight: lhH,
                  letterSpacing: "-0.015em",
                  margin: 0,
                }}
              >
                {activeDrawerSource.title}
              </h3>
              <dl style={{ margin: 0, borderTop: "2px solid var(--color-divider)" }}>
                <div style={{ padding: "12px 0", borderBottom: "1px solid var(--color-divider)" }}>
                  <dt
                    style={{
                      fontSize: "13px",
                      color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                    }}
                  >
                    {t.drawer.issuer}
                  </dt>
                  <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{activeDrawerSource.issuer}</dd>
                </div>
                <div style={{ padding: "12px 0", borderBottom: "1px solid var(--color-divider)" }}>
                  <dt
                    style={{
                      fontSize: "13px",
                      color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                    }}
                  >
                    {t.drawer.ref}
                  </dt>
                  <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{activeDrawerSource.ref}</dd>
                </div>
                <div style={{ padding: "12px 0", borderBottom: "1px solid var(--color-divider)" }}>
                  <dt
                    style={{
                      fontSize: "13px",
                      color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                    }}
                  >
                    {t.ui.dates}
                  </dt>
                  <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{activeDrawerSource.dates}</dd>
                </div>
              </dl>
              <div style={{ background: "var(--color-surface)", padding: "20px" }}>
                <p
                  style={{
                    fontSize: "12px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    margin: "0 0 8px",
                  }}
                >
                  {t.drawer.extract}
                </p>
                <p
                  style={{
                    fontSize: "14.5px",
                    lineHeight: 1.6,
                    margin: 0,
                    color: "color-mix(in srgb,var(--color-text) 86%,transparent)",
                  }}
                >
                  {activeDrawerSource.extract || t.drawer.extractNote}
                </p>
              </div>
              <div style={{ marginTop: "auto" }}>
                <button
                  type="button"
                  onClick={() => {
                    const title = activeDrawerSource.title;
                    setSrcDrawer(null);
                    launchWorkspaceWithQuery(title, "databases");
                  }}
                  className="btn btn-secondary"
                  style={{
                    minHeight: "48px",
                    padding: "12px 18px",
                    justifyContent: "flex-start",
                    gap: "10px",
                  }}
                >
                  {t.drawer.original}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                  >
                    <path d="M15 3h6v6M10 14 21 3M18 13v8H3V6h8" />
                  </svg>
                </button>
                <p
                  style={{
                    fontSize: "13px",
                    margin: "10px 0 0",
                    color: "color-mix(in srgb,var(--color-text) 72%,transparent)",
                  }}
                >
                  {t.drawer.originalNote}
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TRIAL / SIGN-IN / ENTERPRISE ACTIVATION MODAL
          ════════════════════════════════════════════════════════════════════ */}
      {trialModal.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            display: "grid",
            placeItems: "center",
            padding: "20px",
            background: "rgba(12, 17, 27, 0.65)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              width: "min(480px, 100%)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              border: "2px solid var(--color-text)",
              padding: "28px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                style={{
                  fontSize: "12px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: "var(--color-accent-700)",
                }}
              >
                {trialModal.mode === "signin"
                  ? t.nav.signIn
                  : trialModal.mode === "enterprise"
                  ? t.pricing.ent.n
                  : `${t.nav.trial} · ${trialModal.selectedPlan || "Professional"}`}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={() => setTrialModal((prev) => ({ ...prev, open: false }))}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25 }}
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <h3 style={{ fontSize: "24px", lineHeight: lhH, margin: 0 }}>
              {lang === "th"
                ? trialModal.mode === "signin"
                  ? "เข้าสู่พื้นที่ทำงาน REG24"
                  : "เริ่มใช้งาน REG24 ทันที"
                : trialModal.mode === "signin"
                ? "Sign in to REG24 Workspace"
                : "Start your REG24 Trial & Open Workspace"}
            </h3>

            <p
              style={{
                fontSize: "14.5px",
                lineHeight: 1.55,
                margin: 0,
                color: "color-mix(in srgb,var(--color-text) 78%,transparent)",
              }}
            >
              {lang === "th"
                ? `บทบาทที่เลือกไว้: ${curRole.name} · ระบบค้นคว้ากฎหมาย 38 ฉบับ, 553 แบบฟอร์มกฎหมาย, คำพิพากษาศาลฎีกา และข้อหารือกรมสรรพากรพร้อมใช้งาน`
                : `Preselected role: ${curRole.name} · Full access to 38 Thai laws, 553 legal forms, Supreme Court precedents, and Revenue Department rulings.`}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600 }}>
                {lang === "th" ? "อีเมลทำงาน (ไม่บังคับสำหรับโหมดทดลองทันที)" : "Work Email (optional for instant workspace access)"}
                <input
                  type="email"
                  value={trialModal.email}
                  onChange={(e) => setTrialModal((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="counsel@firm.co.th"
                  style={{
                    width: "100%",
                    minHeight: "42px",
                    marginTop: "6px",
                    padding: "8px 12px",
                    font: "inherit",
                    fontSize: "14px",
                    color: "var(--color-text)",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-divider)",
                  }}
                />
              </label>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "4px" }}>
              <button
                type="button"
                onClick={() => {
                  setTrialModal((prev) => ({ ...prev, open: false }));
                  launchWorkspaceWithQuery(undefined, "research");
                }}
                className="btn btn-primary"
                style={{
                  flex: 1,
                  minHeight: "48px",
                  padding: "12px 18px",
                  fontSize: "15px",
                  justifyContent: "space-between",
                }}
              >
                <span>{lang === "th" ? "เข้าสู่พื้นที่ทำงาน REG24 ทันที" : "Enter Live REG24 Workspace"}</span>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  style={{ strokeWidth: 2.25, strokeLinecap: "square" }}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTrialModal((prev) => ({ ...prev, open: false }));
                  launchWorkspaceWithQuery(undefined, "control");
                }}
                className="btn btn-secondary"
                style={{
                  minHeight: "48px",
                  padding: "12px 16px",
                  fontSize: "14px",
                }}
              >
                {lang === "th" ? "ดูแผนและโควต้าทดลองใช้" : "Trial & Billing Console"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
