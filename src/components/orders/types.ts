export interface OrderListItem {
  id: string;
  bigcommerceOrderId: number;
  status: string;
  statusId: number | null;
  customerName: string | null;
  customerEmail: string | null;
  totalIncTax: string;
  currencyCode: string | null;
  itemCount: number;
  orderCreatedAt: string | null;
  createdAt: string;
}
