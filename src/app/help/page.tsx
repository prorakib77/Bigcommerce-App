'use client';

// BigDesign's components use React Context internally, which only works in
// the client React runtime — any file importing them directly (not through
// an already-'use client' wrapper) must be a Client Component itself, even
// when, as here, the page has no interactivity of its own.
import { Box, H1, H3, Panel, Text } from '@bigcommerce/big-design';
import { BulletList, BulletItem } from '@/components/shared/bullet-list';

export default function HelpPage(): React.JSX.Element {
  return (
    <Box>
      <H1>Help</H1>

      <Panel header="Creating a Kickflip API token">
        <Text>
          In your Kickflip (gokickflip.com) admin, generate an API token scoped to{' '}
          <strong>read-only access to saved designs</strong>. This app never needs write access to
          your Kickflip account — if a read-only scope option is available, use it.
        </Text>
      </Panel>

      <Panel header="Finding your tenant ID">
        <Text>
          Your Kickflip tenant ID identifies your account to the Kickflip API. It&rsquo;s shown in
          your Kickflip account/organization settings. Enter it exactly as shown on the Settings
          page.
        </Text>
      </Panel>

      <Panel header="What data is imported">
        <Text>
          For each design you choose to import, this app creates a BigCommerce product with:
        </Text>
        <BulletList>
          <BulletItem>
            Name, price, and a sanitized customization summary as the description
          </BulletItem>
          <BulletItem>Up to your configured maximum number of images</BulletItem>
          <BulletItem>
            Private app-only metadata linking the product back to the Kickflip design
          </BulletItem>
        </BulletList>
        <Text>
          No customer or order data is ever imported — only saved design/product records you choose
          from the Designs page.
        </Text>
      </Panel>

      <Panel header="Why products default to hidden">
        <Text>
          Imported products are created with visibility off by default so you can review pricing,
          images, and categorization before customers can see them. Change this in Settings if
          you&rsquo;d rather publish immediately.
        </Text>
      </Panel>

      <Panel header="How duplicate prevention works">
        <Text>
          Each Kickflip design is mapped to at most one BigCommerce product, enforced at the
          database level. Importing the same design again updates the existing product (if its
          content changed) or is skipped entirely (if nothing changed) — it never creates a second
          product.
        </Text>
      </Panel>

      <Panel header="Retrying a failed or partial import">
        <Text>
          Open the Imports page and click <strong>Retry</strong> on any failed or
          partially-completed import. Retries resume from where the import left off — if a product
          was already created, retrying never creates a second one; it only finishes the remaining
          steps (e.g. images or metadata).
        </Text>
      </Panel>

      <Panel header="What happens when the app is uninstalled">
        <Text>
          Uninstalling immediately stops new imports and revokes active sessions, but{' '}
          <strong>never deletes any BigCommerce products</strong> the app created. Import history
          and mappings are preserved for a retention period so reinstalling can pick up where you
          left off.
        </Text>
      </Panel>

      <Panel header="Current feature exclusions">
        <Text>
          This release imports saved Kickflip designs as static BigCommerce products. It does not
          include:
        </Text>
        <BulletList>
          <BulletItem>Live Kickflip configurator embedding on the storefront</BulletItem>
          <BulletItem>
            Dynamic storefront pricing or cart integration with the customizer
          </BulletItem>
          <BulletItem>Order synchronization or automatic fulfillment</BulletItem>
          <BulletItem>
            Turning every customization choice into a BigCommerce product variant
          </BulletItem>
          <BulletItem>
            Automatic currency conversion (a currency mismatch blocks the import instead)
          </BulletItem>
          <BulletItem>
            Deleting BigCommerce products when a design disappears from Kickflip
          </BulletItem>
        </BulletList>
      </Panel>

      <H3>Still stuck?</H3>
      <Text color="secondary60">
        Check the Imports page for the specific error on a failed import, or contact your app
        administrator.
      </Text>
    </Box>
  );
}
