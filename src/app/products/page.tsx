import { RequireSession } from '@/components/shared/require-session';
import { ProductsView } from '@/components/products/products-view';

export default function ProductsPage(): React.JSX.Element {
  return (
    <RequireSession>
      <ProductsView />
    </RequireSession>
  );
}
