export interface CompanyListItem {
  id: string;
  companyName: string;
  gstin: string | null;
  financialYear: string;
  role: string;
  createdAt: string;
}

export interface CompanyDetail extends CompanyListItem {
  legalName: string | null;
  pan: string | null;
  currency: string;
  timezone: string;
  updatedAt: string;
}

export interface CompanyMember {
  userId: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}

export function getSelectedCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("selectedCompanyId");
}

export function setSelectedCompanyId(id: string) {
  localStorage.setItem("selectedCompanyId", id);
}
