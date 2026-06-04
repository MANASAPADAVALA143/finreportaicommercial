// Approval Workflow System

export type ApprovalLevel = 'none' | 'manager' | 'cfo';

/**
 * Determines the required approval level based on invoice amount
 */
export function getRequiredApprovalLevel(amount: number): ApprovalLevel {
  if (amount < 500) {
    return 'none'; // Auto-approved
  } else if (amount >= 500 && amount <= 5000) {
    return 'manager'; // Requires Manager approval
  } else {
    return 'cfo'; // Requires CFO approval
  }
}

/**
 * Checks if an invoice is pending approval
 */
export function isPendingApproval(
  status: string,
  approvalLevel: ApprovalLevel | null,
  approvedBy: string | null
): boolean {
  if (status === 'Rejected' || status === 'Paid') {
    return false;
  }
  if (approvalLevel === 'none') {
    return false; // Auto-approved, no approval needed
  }
  return !approvedBy; // Pending if no approver yet
}

/**
 * Gets the display name for approval level
 */
export function getApprovalLevelName(level: ApprovalLevel): string {
  switch (level) {
    case 'none':
      return 'Auto-Approved';
    case 'manager':
      return 'Manager Approval Required';
    case 'cfo':
      return 'CFO Approval Required';
    default:
      return 'Unknown';
  }
}
