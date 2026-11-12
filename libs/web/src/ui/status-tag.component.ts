import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ProductStatus } from '@product-finder/shared';
import { TagModule } from 'primeng/tag';

type Severity = 'success' | 'warn' | 'danger' | 'secondary';

interface StatusView {
  label: string;
  icon: string;
  severity: Severity;
}

/** Labels for each status. Text and icon, never colour alone. */
export function statusView(status: ProductStatus, inLatestExport = true): StatusView {
  if (!inLatestExport) {
    return { label: 'Not in catalogue', icon: 'pi pi-ban', severity: 'secondary' };
  }
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', icon: 'pi pi-check-circle', severity: 'success' };
    case 'PHASE_OUT':
      return { label: 'Phase-out', icon: 'pi pi-clock', severity: 'warn' };
    case 'DISCONTINUED':
      return { label: 'Discontinued', icon: 'pi pi-ban', severity: 'danger' };
  }
}

@Component({
  selector: 'app-status-tag',
  imports: [TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p-tag [value]="view().label" [icon]="view().icon" [severity]="view().severity" />`,
})
export class StatusTag {
  readonly status = input.required<ProductStatus>();
  readonly inLatestExport = input(true);
  protected readonly view = computed(() => statusView(this.status(), this.inLatestExport()));
}
