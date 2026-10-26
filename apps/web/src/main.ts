import { bootstrapApplication } from '@angular/platform-browser';
import { AplicacionComponent } from './app/app.component';
import { configuracionAplicacion } from './app/app.config';

bootstrapApplication(AplicacionComponent, configuracionAplicacion).catch((error: unknown) => {
  console.error('No fue posible iniciar SIPRA PRÁCTICAS', error);
});
