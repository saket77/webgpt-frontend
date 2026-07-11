export const ROUTINE_TEMPLATES = [
  {
    id: "ipo_gmp_daily",
    name: "IPO GMP Daily Tracker",
    description: "Email open Mainboard IPO rows with subscription over 10x and GMP at least 50%.",
    workflow: {
      type: "supported_workflow",
      templateId: "ipo_gmp_daily",
      strategy: "deterministic_then_browserbase",
      mode: "webgpt",
      execution: "browserbase",
      url: "https://www.investorgain.com/report/ipo-gmp-live/331/ipo/",
      goal:
        "From the InvestorGain Mainboard IPO GMP report, return only open Mainboard IPO rows where subscription is over 10x and GMP is at least +50%. Include name, subscription, GMP amount, GMP percent, price, open date, close date, updated time, and detail URL. If no rows match, say no matching IPOs.",
      filters: {
        parameter: "ipo",
        category: "IPO",
        statusCode: "open",
        minSubscriptionTimes: 10,
        subscriptionComparator: ">",
        minGmpPercent: 50,
      },
    },
    strategy: {
      type: "deterministic_then_browserbase",
      fallbackExecution: "browserbase",
    },
  },
  {
    id: "eprocure_hospital_daily",
    name: "eProcure Hospital Tender Tracker",
    description: "Email eProcure tenders published today that mention Hospital.",
    workflow: {
      type: "supported_workflow",
      templateId: "eprocure_hospital_daily",
      strategy: "deterministic_then_browserbase",
      mode: "webgpt",
      execution: "browserbase",
      url: "https://eprocure.gov.in/eprocure/app?page=FrontEndLatestActiveTendersOrgwise&service=page&org=",
      goal:
        "On the eProcure Latest Active Tenders organisation-wise page, find active tenders whose visible title, tender reference, tender ID, or organisation chain contains the word Hospital and whose e-Published Date is today's date in Asia/Kolkata. Paginate older result pages until the visible e-Published Date becomes older than today, then stop. Return title, tender reference number, tender ID, organisation chain, e-Published Date, bid submission closing date, tender opening date, and detail URL. If no rows match, say no hospital-related tenders were published today.",
      filters: {
        keyword: "Hospital",
        timezone: "Asia/Kolkata",
        maxPages: 25,
      },
    },
    strategy: {
      type: "deterministic_then_browserbase",
      fallbackExecution: "browserbase",
    },
  },
];

export function listRoutineTemplates() {
  return ROUTINE_TEMPLATES.map((template) => ({
    ...template,
    workflow: {
      ...template.workflow,
      filters: template.workflow.filters ? { ...template.workflow.filters } : undefined,
    },
    strategy: { ...template.strategy },
  }));
}

export function getRoutineTemplate(id) {
  return listRoutineTemplates().find((template) => template.id === id) || null;
}
