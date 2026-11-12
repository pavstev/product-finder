import { afterNextRender, DOCUMENT, Injectable, Injector, inject, untracked } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

const APP_NAME = 'Product Finder';
/** Same text as the description in index.html. */
export const DEFAULT_DESCRIPTION =
  'Search the specialty chemicals catalogue, compare products and read customer reviews.';

/** The tab title and description of each page. After a page change the first h1 gets the focus, for screen readers. */
@Injectable({ providedIn: 'root' })
export class PageTitle {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  /** True after a navigation to another page, until its h1 has the focus. */
  private focusPending = false;

  constructor() {
    let lastPath: string | null = null;
    inject(Router)
      .events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const path = event.urlAfterRedirects.split(/[?#]/)[0];
        // The first page and a new query on the same page keep the focus where it is.
        if (lastPath !== null && path !== lastPath) {
          this.focusPending = true;
          this.focusHeading();
        }
        lastPath = path;
      });
  }

  /** Sets the tab title to "<title> | Product Finder" and the description meta tag. */
  set(title: string, description = DEFAULT_DESCRIPTION): void {
    this.title.setTitle(`${title} | ${APP_NAME}`);
    this.meta.updateTag({ name: 'description', content: description });
    // A page that loads its data shows its h1 late. It calls set() when the data is there.
    this.focusHeading();
  }

  /** After the next render, focus the first h1 if a page change is waiting for it. */
  private focusHeading(): void {
    if (!this.focusPending) {
      return;
    }
    // Pages call set() from an effect. The render hook is not part of that effect.
    untracked(() =>
      afterNextRender(
        () => {
          const heading = this.document.querySelector<HTMLElement>('h1');
          if (!this.focusPending || !heading) {
            return;
          }
          this.focusPending = false;
          if (!heading.hasAttribute('tabindex')) {
            heading.setAttribute('tabindex', '-1');
          }
          // No scroll: the router restores the scroll position on back and forward.
          heading.focus({ preventScroll: true });
        },
        { injector: this.injector },
      ),
    );
  }
}
