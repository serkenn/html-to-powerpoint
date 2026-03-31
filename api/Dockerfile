FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl fonts-ipafont-gothic fonts-noto-cjk \
  && mkdir -p /usr/local/share/fonts/montserrat \
  && curl -fsSL https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat-Regular.ttf \
    -o /usr/local/share/fonts/montserrat/Montserrat-Regular.ttf \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8788

EXPOSE 8788

CMD ["npm", "start"]
