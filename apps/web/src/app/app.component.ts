import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type ElementRef, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterOutlet } from '@angular/router';
import { CatalogApi, NavigationHistory, PageTitle } from '@product-finder/web';
import { ToastModule } from 'primeng/toast';
import { catchError, of } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [DatePipe, RouterLink, RouterOutlet, ToastModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class App {
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  constructor() {
    // Created here so they see every navigation from the start.
    inject(NavigationHistory);
    inject(PageTitle);
  }

  protected readonly catalog = toSignal(
    inject(CatalogApi)
      .catalogStatus()
      .pipe(catchError(() => of(null))),
    {
      initialValue: null,
    },
  );

  // With `<base href="/">` the link "#main" points to "/#main" and would reload the page. Move the focus instead.
  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}
