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
