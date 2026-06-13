/**
 * SubscriptionStatusCard — Displays current subscription info.
 *
 * Shows the subscription status badge, monthly price, and an optional
 * "Manage Billing" button. Handles all status states including active,
 * past_due, canceled, trialing, etc.
 *
 * Adapted from Togather's BillingScreen component.
 *
 * @example
 * ```tsx
 * import { SubscriptionStatusCard } from "@supa-media/payments/components";
 *
 * <SubscriptionStatusCard
 *   subscription={subscriptionData}
 *   onManageBilling={() => openBillingPortal()}
 *   showPrice
 *   showManageButton
 * />
 * ```
 */

import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import type { ReactElement } from "react";
import type { Subscription, SubscriptionStatus } from "../types";
import { useSubscription } from "../hooks/useSubscription";

// =============================================================================
// Status Display
// =============================================================================

interface StatusStyle {
  backgroundColor: string;
  textColor: string;
  label: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  active: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    textColor: "#10B981",
    label: "Active",
  },
  trialing: {
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    textColor: "#3B82F6",
    label: "Trialing",
  },
  past_due: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    textColor: "#F59E0B",
    label: "Past Due",
  },
  canceled: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    textColor: "#EF4444",
    label: "Canceled",
  },
  unpaid: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    textColor: "#EF4444",
    label: "Unpaid",
  },
  incomplete: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    textColor: "#F59E0B",
    label: "Incomplete",
  },
  paused: {
    backgroundColor: "rgba(107, 114, 128, 0.1)",
    textColor: "#6B7280",
    label: "Paused",
  },
};

function getStatusStyle(status: string | null): StatusStyle {
  if (!status) {
    return {
      backgroundColor: "rgba(107, 114, 128, 0.1)",
      textColor: "#6B7280",
      label: "Unknown",
    };
  }
  return (
    STATUS_STYLES[status] ?? {
      backgroundColor: "rgba(107, 114, 128, 0.1)",
      textColor: "#6B7280",
      label: status,
    }
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatPrice(amount: number | null | undefined): string {
  if (amount == null) return "--";
  return `$${amount.toLocaleString()}`;
}

// =============================================================================
// Component
// =============================================================================

interface SubscriptionStatusCardProps {
  /**
   * Raw subscription query result. Passed directly to useSubscription().
   * Pass `undefined` while loading, `null` if no subscription.
   */
  subscription: Record<string, unknown> | null | undefined;
  /** Whether to show the manage billing button */
  showManageButton?: boolean;
  /** Callback when the manage billing button is pressed */
  onManageBilling?: () => void;
  /** Whether the manage billing action is loading */
  manageBillingLoading?: boolean;
  /** Whether to show the price information */
  showPrice?: boolean;
  /** Warning message for past_due or canceled statuses */
  pastDueMessage?: string;
  /** Warning message for canceled status */
  canceledMessage?: string;
}

export function SubscriptionStatusCard({
  subscription: rawSubscription,
  showManageButton = true,
  onManageBilling,
  manageBillingLoading = false,
  showPrice = true,
  pastDueMessage = "Payment past due. Please update your payment method.",
  canceledMessage = "Subscription canceled. Contact support to reactivate.",
}: SubscriptionStatusCardProps): ReactElement | null {
  const { subscription, isLoading } = useSubscription(
    rawSubscription as Parameters<typeof useSubscription>[0]
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#6B7280" />
      </View>
    );
  }

  if (!subscription || !subscription.status) {
    return (
      <View style={styles.card}>
        <Text style={styles.noSubscriptionText}>No active subscription</Text>
      </View>
    );
  }

  const statusStyle = getStatusStyle(subscription.status);

  return (
    <View style={styles.card}>
      {/* Status row */}
      <View style={styles.row}>
        <Text style={styles.label}>Status</Text>
        <View
          style={[
            styles.badge,
            { backgroundColor: statusStyle.backgroundColor },
          ]}
        >
          <Text style={[styles.badgeText, { color: statusStyle.textColor }]}>
            {statusStyle.label}
          </Text>
        </View>
      </View>

      {/* Price row */}
      {showPrice && (
        <>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Monthly Price</Text>
            <Text style={styles.value}>
              {formatPrice(subscription.priceMonthly)}/month
            </Text>
          </View>
        </>
      )}

      {/* Manage billing button */}
      {showManageButton && onManageBilling && (
        <>
          <View style={styles.divider} />
          <Pressable
            onPress={onManageBilling}
            disabled={manageBillingLoading}
            style={[
              styles.button,
              manageBillingLoading && styles.buttonDisabled,
            ]}
          >
            {manageBillingLoading && (
              <ActivityIndicator
                size="small"
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
            )}
            <Text style={styles.buttonText}>
              {manageBillingLoading
                ? "Opening Billing Portal..."
                : "Manage Billing"}
            </Text>
          </Pressable>
        </>
      )}

      {/* Past due warning */}
      {subscription.status === "past_due" && (
        <View style={[styles.warningBox, styles.warningBoxYellow]}>
          <Text style={styles.warningTextYellow}>{pastDueMessage}</Text>
        </View>
      )}

      {/* Canceled warning */}
      {subscription.status === "canceled" && (
        <View style={[styles.warningBox, styles.warningBoxRed]}>
          <Text style={styles.warningTextRed}>{canceledMessage}</Text>
        </View>
      )}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.1)",
    padding: 20,
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6B7280",
  },
  value: {
    fontSize: 16,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.06)",
    marginVertical: 14,
  },
  button: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: "#3B82F6",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  noSubscriptionText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
    paddingVertical: 16,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  warningBoxYellow: {
    backgroundColor: "rgba(245, 158, 11, 0.06)",
    borderColor: "rgba(245, 158, 11, 0.2)",
  },
  warningBoxRed: {
    backgroundColor: "rgba(239, 68, 68, 0.06)",
    borderColor: "rgba(239, 68, 68, 0.2)",
  },
  warningTextYellow: {
    fontSize: 14,
    lineHeight: 20,
    color: "#F59E0B",
  },
  warningTextRed: {
    fontSize: 14,
    lineHeight: 20,
    color: "#EF4444",
  },
});
