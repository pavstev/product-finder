import { provideHttpClient, withFetch } from '@angular/common/http';
import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';
import { PRIMENG_LICENSE } from './primeng-license';

// Aura with a blue primary. Shade 600 (4.9 to 1) and red 700 for errors (5.9 to 1) pass WCAG AA (4.5 to 1);
// the Aura defaults (3.5 and 4.4 to 1) do not.
const Theme = definePreset(Aura, {
  components: {
    message: {
      error: {
        color: 'light-dark({red.700}, {red.500})',
      },
    },
  },
  semantic: {
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
      },
    },
    primary: {
      50: '{blue.50}',
      100: '{blue.100}',
      200: '{blue.200}',
      300: '{blue.300}',
      400: '{blue.400}',
      500: '{blue.500}',
      600: '{blue.600}',
      700: '{blue.700}',
      800: '{blue.800}',
      900: '{blue.900}',
      950: '{blue.950}',
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    provideHttpClient(withFetch()),
    providePrimeNG({
      theme: { preset: Theme, options: { darkModeSelector: false } },
      ...(PRIMENG_LICENSE ? { license: PRIMENG_LICENSE } : {}),
    }),
    MessageService,
  ],
};
