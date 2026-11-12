import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ProductStatus } from '@product-finder/shared';
import { ChipModule } from 'primeng/chip';
import { RatingStars } from './rating-stars.component';
import { StatusTag } from './status-tag.component';

/** The fields the card shows. Its own type, so the ui folder does not import data-access. */
export interface ProductCardData {
  sku: string;
  name: string;
  chemicalName: string | null;
  function: string;
  applicationArea: string;
  region: string;
  certifications: string[];
  status: ProductStatus;
  ratingAvg: number | null;
  reviewCount: number;
}

@Component({
  selector: 'app-product-card',
  imports: [RouterLink, ChipModule, StatusTag, RatingStars],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = product();
    <article class="card">
      <header>
        <h2>
          <a [routerLink]="['/products', p.sku]">{{ p.name }}</a>
        </h2>
        <app-status-tag [status]="p.status" />
      </header>
      <p class="meta">
        <span class="sku">{{ p.sku }}</span>
        @if (p.chemicalName) {
          <span>{{ p.chemicalName }}</span>
        }
      </p>
      <dl>
        <div>
          <dt>Function</dt>
          <dd>{{ p.function }}</dd>
        </div>
        <div>
          <dt>Application</dt>
          <dd>{{ p.applicationArea }}</dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{{ p.region }}</dd>
        </div>
      </dl>
      @if (p.certifications.length > 0) {
        <ul class="chips" aria-label="Certifications">
          @for (cert of p.certifications; track cert) {
            <li><p-chip [label]="cert" /></li>
          }
        </ul>
      }
      <app-rating-stars [rating]="p.ratingAvg" [count]="p.reviewCount" />
    </article>
  `,
  styleUrl: './product-card.component.scss',
})
export class ProductCard {
  readonly product = input.required<ProductCardData>();
}
