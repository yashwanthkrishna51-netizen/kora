/**
 * Deliberately hostile v1 sample data.
 *
 * Every record here exists because it is a way the migration could silently
 * lose or corrupt data. They are far cheaper to meet on a throwaway database
 * than during a cutover window:
 *
 *   - a client in the Implementation domain with ZERO modules (null-sentinel)
 *   - duplicate client names differing only by case
 *   - an unparseable due date ("TBD")
 *   - a work-log entry with no dateRaised (NOT NULL in v2)
 *   - a phase carrying the legacy `moduleId::phaseName` synthetic id
 *   - a phase with no id at all
 *   - a duplicate phase name inside one module
 *   - a phase name outside the fixed nine
 *   - attachments as public URL, expired signed URL, bare path, foreign URL
 *
 * Shared by seed-test-db.ts and the end-to-end tests so both exercise exactly
 * the same cases.
 */

export interface SampleV1Client {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  integrations?: unknown[];
  modules?: unknown[];
  work_log?: unknown[];
  man_day_rate?: number;
  total_available_hours?: number;
  currency?: string;
  master_assignee?: string;
}

const signed = (p: string) =>
  `https://demo.supabase.co/storage/v1/object/sign/kora-attachments/${p}?token=expired`;
const publicUrl = (p: string) =>
  `https://demo.supabase.co/storage/v1/object/public/kora-attachments/${p}`;

export const SAMPLE_V1_CLIENTS: SampleV1Client[] = [
  {
    id: "c_aster",
    name: "Aster Retail Group",
    description: "SAP SuccessFactors",
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-08-01T09:30:00Z",
    integrations: [
      {
        id: "i_payroll",
        name: "Payroll → SAP posting",
        status: "At Risk",
        assignee: "Kavya Iyer",
        dueDate: "2026-09-02",
        effortWeight: 1,
        createdAt: "2026-02-01T09:00:00Z",
        timeline: [
          {
            id: "t1",
            date: "2026-08-20",
            update: "Signed off by finance",
            addedBy: "Meera Raghavan",
            addedAt: "2026-08-20T11:00:00Z",
            attachment: {
              url: signed("1_a_signoff.pdf"),
              fileName: "signoff.pdf",
              mimeType: "application/pdf",
              sizeBytes: 20481,
            },
          },
          {
            id: "t2",
            date: "2026-08-10",
            update: "Mapping reviewed",
            addedBy: "Kavya Iyer",
            attachment: {
              url: publicUrl("2_b_mapping.xlsx"),
              fileName: "mapping.xlsx",
            },
          },
        ],
        milestones: [
          { id: "ms1", name: "Field mapping agreed", status: "Achieved", dueDate: "2026-07-01" },
          // No id — must be derived.
          { name: "Parallel run", status: "Pending", dueDate: "2026-09-15" },
        ],
      },
      {
        // Unparseable date: a GATE. The old dual-write sent this straight into
        // a `date` column and silently failed the client's whole shadow write.
        id: "i_benefits",
        name: "Benefits vendor API",
        status: "In Progress",
        dueDate: "TBD",
        timeline: [],
        milestones: [],
      },
    ],
    modules: [
      {
        id: "m_corehr",
        name: "Core HR",
        phases: [
          // Legacy synthetic id — must be re-minted.
          { id: "m_corehr::BPU", name: "BPU", status: "Completed", targetDate: "2026-03-01" },
          // No id — must be derived.
          { name: "BPU Signoff", status: "Completed", targetDate: "2026-03-15" },
          {
            id: "ph_crp",
            name: "CRP",
            status: "In Progress",
            targetDate: "2026-09-30",
            updates: [
              {
                id: "u1",
                date: "2026-08-25",
                update: "CRP cycle 1 done",
                addedBy: "Rohan Desai",
                addedAt: "2026-08-25T10:00:00Z",
                attachment: { storagePath: "3_c_crp.pdf", fileName: "crp.pdf" },
              },
            ],
          },
        ],
      },
    ],
    work_log: [
      {
        id: "w1",
        dateRaised: "2026-08-04",
        description: "Leave accrual mis-posting",
        type: "Bug Fix",
        queryLevel: "L4 - Critical",
        entryStatus: "Open",
        hours: 6.5,
        loggedAt: "2026-08-04T12:00:00Z",
      },
      {
        // No dateRaised — must fall back to loggedAt, not fail the insert.
        id: "w2",
        description: "Shift roster export failing",
        type: "Support Ticket",
        queryLevel: "L3 - High",
        entryStatus: "In Progress",
        hours: 2,
        loggedAt: "2026-07-22T11:00:00Z",
      },
    ],
    man_day_rate: 8000,
    total_available_hours: 120,
    currency: "INR",
    master_assignee: "Arjun Mehta",
  },
  {
    // In the Implementation domain with ZERO modules. If membership were
    // inferred from row count this client would vanish from /implementation.
    id: "c_empty_impl",
    name: "Nirvana Hospitality",
    created_at: "2026-04-01T10:00:00Z",
    updated_at: "2026-08-02T10:00:00Z",
    integrations: [],
    modules: [],
    work_log: [],
    currency: "USD",
  },
  {
    id: "c_dup_a",
    name: "Vantage Logistics",
    created_at: "2026-02-01T10:00:00Z",
    updated_at: "2026-08-03T10:00:00Z",
    integrations: [],
    modules: [
      {
        id: "m_dup",
        name: "Payroll",
        phases: [
          { id: "p_a", name: "UAT", status: "In Progress" },
          // Duplicate phase name in one module — violates the unique index.
          { id: "p_b", name: "UAT", status: "Not Started" },
          // Not one of the fixed nine.
          { id: "p_c", name: "Discovery", status: "Not Started" },
        ],
      },
    ],
  },
  {
    // Same name as c_dup_a, differing only by case — gates migration 0004.
    id: "c_dup_b",
    name: "vantage logistics",
    created_at: "2026-02-02T10:00:00Z",
    updated_at: "2026-08-04T10:00:00Z",
    integrations: [
      {
        id: "i_foreign",
        name: "Doc link",
        status: "Not Started",
        timeline: [
          {
            id: "t9",
            date: "2026-08-01",
            update: "external doc",
            addedBy: "M",
            // Foreign URL — not resolvable to a storage path; must be kept.
            attachment: { url: "https://sharepoint.example.com/x.docx" },
          },
        ],
      },
    ],
  },
  {
    // Integrations-only client: neither modules nor work_log keys present.
    id: "c_integ_only",
    name: "Harbour Freight Co",
    created_at: "2026-05-01T10:00:00Z",
    updated_at: "2026-08-05T10:00:00Z",
    integrations: [
      { id: "i_h1", name: "EDI feed", status: "Completed", dueDate: "2026-06-01" },
    ],
  },
];
