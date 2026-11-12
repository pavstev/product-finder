import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonDirective } from 'primeng/button';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, ButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="not-found">
      <i class="pi pi-search" aria-hidden="true"></i>
      <h1>{{ heading() }}</h1>
      <p>{{ message() }}</p>
      <a pButton routerLink="/products"
        ><i class="pi pi-arrow-left" aria-hidden="true"></i>Search the catalogue</a
      >
    </section>
  `,
  styles: `
    .not-found {
      text-align: center;
      padding: 3rem 1rem;
    }
    .pi-search {
      font-size: 2.5rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class NotFoundPage {
  readonly heading = input('Page not found');
  readonly message = input('The page you are looking for does not exist.');
}
