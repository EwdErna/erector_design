<template>
  <div class="app-container">
    <nav>
      <Navigation></Navigation>
    </nav>
    <main>
      <section class="left">
        <SelectComponents></SelectComponents>
      </section>
      <section class="center">
        <div class="scene-area">
          <ThreeDScene></ThreeDScene>
        </div>
        <div class="error-area">
          <InvalidConnections></InvalidConnections>
        </div>
      </section>
      <section class="right">
        <EditComponent></EditComponent>
      </section>
    </main>
    <footer></footer>
  </div>
</template>

<style scoped>
@media (min-width: 769px), (pointer: fine) {
  .app-container {
    height: calc(100vh - 16px);

    nav {
      height: 64px;
    }

    footer {
      height: 20px;
    }

    main {
      width: 100%;
      height: calc(100% - 84px);
      display: flex;

      .left {
        width: 25%;
        background-color: #f0f0f0;
      }

      .right {
        width: 25%;
        background-color: #f0f0f0;
      }

      .center {
        width: 50%;
        display: flex;
        flex-direction: column;

        .scene-area {
          flex: 0 0 80%;
          overflow: hidden;
        }

        .error-area {
          flex: 0 0 20%;
          overflow: hidden;
        }
      }
    }
  }
}
</style>