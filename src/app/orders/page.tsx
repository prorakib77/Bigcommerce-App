import { RequireSession } from '@/components/shared/require-session';
import { OrdersView } from '@/components/orders/orders-view';

export default function OrdersPage(): React.JSX.Element {
  return (
    <RequireSession>
      <OrdersView />
    </RequireSession>
  );
}
