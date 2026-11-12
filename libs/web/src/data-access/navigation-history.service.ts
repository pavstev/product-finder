import { Location } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Remembers whether the page was opened from another page of the app, for "Back to results". */
@Injectable({ providedIn: 'root' })
export class NavigationHistory {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private previousUrl: string | null = null;
  private currentUrl: string | null = null;

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.previousUrl = this.currentUrl;
        this.currentUrl = event.urlAfterRedirects;
      });
  }

  /** Back to the last in-app URL. A user who came from outside (a shared link) goes to the search. */
  back(): void {
    if (this.previousUrl !== null) {
      this.location.back();
    } else {
      void this.router.navigateByUrl('/products');
    }
  }
}
