export { AlertService } from '@/global/alerting/alert.service';
export { AlertingModule } from '@/global/alerting/alerting.module';
export {
  postDiscordAlert,
  type AlertMessage,
} from '@/global/alerting/discord-webhook';
export { shouldSendBootAlert } from '@/global/alerting/boot-alert-throttle';
