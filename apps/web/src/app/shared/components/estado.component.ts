import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EtiquetaPipe } from '../pipes/etiquetas.pipe';

type Tono = 'ok' | 'aviso' | 'peligro' | 'info' | 'neutra';

const TONOS: Record<string, Tono> = {
  // Prácticas
  activa: 'ok', certificada: 'ok', finalizada: 'info',
  en_validacion: 'aviso', documentacion: 'aviso', inscrita: 'neutra',
  suspendida: 'peligro', cancelada: 'peligro', anulada: 'neutra', reprobada: 'peligro',
  // Señales
  al_dia: 'ok', requiere_atencion: 'aviso', en_riesgo: 'peligro',
  // Documentos
  auto_aprobado: 'ok', aprobado: 'ok', en_revision: 'aviso',
  ilegible: 'aviso', devuelto: 'aviso', rechazado: 'peligro',
  recibido: 'neutra', analizando: 'info',
  // Empresas
  habilitada: 'ok', en_verificacion: 'aviso', requiere_info: 'aviso',
  solicitud_recibida: 'neutra', rechazada: 'peligro',
  // Obligaciones y semáforos
  cumplida: 'ok', pendiente: 'aviso', vencida: 'peligro', no_aplica: 'neutra',
  vigente: 'ok', critica: 'peligro', alerta: 'aviso',
  verde: 'ok', amarillo: 'aviso', rojo: 'peligro',
  // Solicitudes de ARL y criterios
  radicada: 'aviso', aprobada: 'ok', certificado_enviado: 'ok', anulada_arl: 'neutra',
  cumple: 'ok', no_cumple: 'peligro', revision_manual: 'aviso', aprobar: 'ok', rechazar: 'peligro',
  // Bitácora
  mensaje_libre: 'neutra', seguimiento: 'info', evaluacion_final: 'info', evalua_tu_proceso: 'ok',
  calificacion_docente: 'ok', plazo_subsanacion: 'aviso', sistema: 'neutra',
  // Vacantes
  publicada: 'ok', reportada_spe: 'info', borrador: 'neutra', cerrada: 'neutra',
  en_tramite: 'info', respondida: 'ok', unificada: 'neutra',
};

/** Etiqueta de estado con tono coherente en toda la aplicación. */
@Component({
  selector: 'sipra-estado',
  standalone: true,
  imports: [EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="etiqueta etiqueta--{{ tono() }}">{{ valor() | etiqueta }}</span>`,
})
export class EstadoComponent {
  readonly valor = input.required<string | null | undefined>();
  readonly tono = computed<Tono>(() => TONOS[this.valor() ?? ''] ?? 'neutra');
}
