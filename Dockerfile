# The JK Performance API. No npm dependencies: Node built-ins only.
FROM node:22.23.3-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
RUN rm -rf server/test \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
EXPOSE 5670
CMD ["node", "server/main.mjs"]
