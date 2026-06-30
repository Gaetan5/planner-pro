export interface ProjectFinance {
  projectId: string;
  projectName: string;
  billingType: string | null;
  budgetCents: number | null;
  totalHours: number;
  actualCostCents: number;
  actualRevenueCents: number;
  marginCents: number;
  marginPercent: number;
  burnPercent: number;
  hasBudgetAlert: boolean;
}

export interface WorkspaceSummary {
  workspaceId: string;
  totalBudget: number;
  totalCost: number;
  totalRevenue: number;
  totalMargin: number;
  totalMarginPercent: number;
  totalHours: number;
  projects: ProjectFinance[];
}
