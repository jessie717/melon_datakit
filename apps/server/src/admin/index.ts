/**
 * 管理 API 汇总 —— 一个 Elysia 插件集合，挂到主应用。
 */
import { Elysia } from 'elysia';
import { projectsAdmin } from './projects';
import { specsAdmin } from './specs';
import { routesAdmin } from './routes';
import { rulesAdmin } from './rules';
import { entitiesAdmin } from './entities';

export const adminRoutes = new Elysia({ name: 'admin' })
  .use(projectsAdmin)
  .use(specsAdmin)
  .use(routesAdmin)
  .use(rulesAdmin)
  .use(entitiesAdmin);

export { toProjectDto, getProjectRow } from './projects';
