import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ChipModule } from 'primeng/chip';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { distinctUntilChanged, map } from 'rxjs';
import type { ProductDetail } from '../data-access/catalog-types';
import { NavigationHistory } from '../data-access/navigation-history.service';
import { ProductDetailStore } from '../data-access/product-detail.store';
import { NotFoundPage } from '../ui/not-found.page';
import { PageTitle } from '../ui/page-title.service';
import { RatingStars } from '../ui/rating-stars.component';
import { StatusTag } from '../ui/status-tag.component';
import { ReviewSection } from './review-section.component';

type DetailView = 'loading' | 'not-found' | 'error' | 'ok';

export interface StatusBanner {
  severity: 'warn' | 'error';
  icon: string;
  text: string;
}

/** The banner that tells a customer whether they can still buy the product. Null for active products. */
export function statusBanner(product: Pick<ProductDetail, 'status' | 'inLatestExport'>): StatusBanner | null {
  if (!product.inLatestExport || product.status === 'DISCONTINUED') {
    return {
      severity: 'error',
      icon: 'pi pi-ban',
      text: 'This product is no longer available. The page is kept for reference. Ask your sales contact for an alternative.',
    };
  }
  if (product.status === 'PHASE_OUT') {
    return {
      severity: 'warn',
      icon: 'pi pi-clock',
      text: 'This product is being phased out. Ask your sales contact for a successor.',
    };
  }
  return null;
}

@Component({
  selector: 'app-product-detail',
  imports: [
    DatePipe,
    ButtonModule,
    ChipModule,
    MessageModule,
    SkeletonModule,
    NotFoundPage,
    RatingStars,
    ReviewSection,
    StatusTag,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ProductDetailStore],
  templateUrl: './product-detail.page.html',
  styleUrl: './product-detail.page.scss',
})
export class ProductDetailPage {
  private readonly history = inject(NavigationHistory);
  private readonly messages = inject(MessageService);
  private readonly pageTitle = inject(PageTitle);
  protected readonly store = inject(ProductDetailStore);

  /** What the template switches on. A product on screen wins: a reload or a failed refresh keeps it. */
  protected readonly view = computed<DetailView>(() => {
    if (this.store.product()) {
      return 'ok';
    }
    const status = this.store.status();
    return status === 'not-found' || status === 'error' ? status : 'loading';
  });
  protected readonly product = this.store.product;
  protected readonly banner = computed(() => {
    const product = this.product();
    return product ? statusBanner(product) : null;
  });

  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(
        map((params) => params.get('sku') ?? ''),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((sku) => {
        this.store.load(sku);
      });

    effect(() => {
      const product = this.store.product();
      const view = this.view();
      if (product) {
        // || and not ??: an empty description gets the default too.
        this.pageTitle.set(product.name, product.description || undefined);
      } else if (view === 'not-found') {
        this.pageTitle.set('Product not found');
      }
    });

    // The store raises a toast as a signal. The page shows it.
    effect(() => {
      const notice = this.store.toast();
      if (notice) {
        untracked(() => {
          this.messages.add({ severity: notice.severity, summary: notice.summary, detail: notice.detail });
        });
      }
    });
  }

  protected back(): void {
    this.history.back();
  }

  /** Retry after an error. */
  protected reload(): void {
    this.store.reload();
  }

  /** Native share sheet on phones, else copy the link. */
  protected async share(product: ProductDetail): Promise<void> {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: product.name, text: `${product.name} (${product.sku})`, url });
        return;
      } catch (error) {
        if ((error as DOMException).name === 'AbortError') {
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.messages.add({
        severity: 'success',
        summary: 'Link copied',
        detail: 'Paste it to share this product.',
      });
    } catch {
      this.messages.add({
        severity: 'warn',
        summary: 'Copy failed',
        detail: 'Copy the link from the address bar.',
      });
    }
  }
}
