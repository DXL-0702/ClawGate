import type { FastifyPluginAsync } from 'fastify';
import { AgentDiscovery, configReader } from '@clawgate/core';

export const agentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/agents', async () => {
    const discovery = new AgentDiscovery(configReader.getAgentsDir());
    const agents = await discovery.discover();
    return { agents, total: agents.length };
  });
};
