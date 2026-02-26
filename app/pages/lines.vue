<script lang="ts" setup>
const { data: lines } = await useFetch('/api/lines')

function goToLine(routeShortName: string | null) {
  if (!routeShortName) return
  navigateTo({ path: '/', query: { line: routeShortName } })
}
</script>

<template>
  <main class="flex h-screen flex-col bg-gray-50 p-8 dark:bg-slate-950">
    <h1 class="mb-6 shrink-0 text-2xl font-bold text-gray-900 dark:text-white">
      Lignes de bus
    </h1>

    <div class="flex-1 overflow-y-auto pb-20 pr-1 overflow-x-hidden">
      <div class="flex flex-col gap-3">
        <div
          v-for="line in lines"
          :key="line.route_id"
          class="flex cursor-pointer items-center rounded-xl bg-white p-4 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md dark:bg-slate-900"
          @click="goToLine(line.route_short_name)"
        >
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-lg font-bold shadow-sm"
            :style="{
              backgroundColor: '#' + (line.route_color || 'ccc'),
              color: '#' + (line.route_text_color || 'fff'),
            }"
          >
            {{ line.route_short_name }}
          </div>

          <div class="ml-4 flex grow flex-col">
            <span class="text-sm font-bold uppercase leading-tight text-gray-800 dark:text-gray-100">
              {{ line.route_long_name }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
