import React, { Component, PropTypes, cloneElement } from 'react';
import {
  Dimensions,
  PanResponder,
  View,
  Animated,
  Easing,
  StyleSheet,
  ImageEditor,
  Image,
} from 'react-native';
import RNFS from 'react-native-fs';
import { AnimatedSurface } from 'gl-react-native';
import { takeSnapshot } from 'react-native-view-shot';
import { distance, angle, center } from './utilities';
const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});

export class ViewEditor extends Component {
  static propTypes = {
    style: View.propTypes.style,
    imageHeight: PropTypes.number.isRequired,
    imageWidth: PropTypes.number.isRequired,
    imageContainerHeight: PropTypes.number,
    imageContainerWidth: PropTypes.number,
    imageMask: PropTypes.any,
    maskHeight: PropTypes.number,
    maskWidth: PropTypes.number,
    maskPadding: PropTypes.number,
    children: PropTypes.any,
    rotate: PropTypes.bool,
    panning: PropTypes.bool,
    center: PropTypes.bool.isRequired,
    croppingRequired: PropTypes.bool.isRequired,
    imageMaskShown: PropTypes.bool.isRequired,
    showAtTop: PropTypes.bool,
    useCustomContent: PropTypes.bool,
    // used for multi-images
    bigContainerWidth: PropTypes.number,
    bigContainerHeight: PropTypes.number,
    requiresMinScale: PropTypes.bool,
    initialScale: PropTypes.number,
    initialPan: PropTypes.object,
    initialRotate: PropTypes.string,
    onPressCallback: PropTypes.func,
    onLongPressCallback: PropTypes.func,
    onLongPressReleaseCallback: PropTypes.func,
    onMoveCallback: PropTypes.func,
    onEndCallback: PropTypes.func,
    onLoad: PropTypes.func,
  }

  static defaultProps = {
    maskWidth: width,
    maskHeight: height,
    maskPadding: 0,
    imageMaskShown: false,
    imageContainerWidth: width,
    imageContainerHeight: height,
    center: true,
    rotate: false,
    panning: true,
    croppingRequired: false,
    requiresMinScale: false,
    initialScale: null,
    initialPan: null,
    showAtTop: false,
    useCustomContent: false,
  }

  constructor(props, context) {
    super(props, context);
    const relativeWidth = props.bigContainerWidth || props.imageContainerWidth;
    const relativeHeight = props.bigContainerHeight || props.imageContainerHeight;
    if (props.requiresMinScale) {
      this._minScale = relativeHeight / props.imageHeight < relativeWidth / props.imageWidth ?
        relativeWidth / props.imageWidth :
        relativeHeight / props.imageHeight;
    } else  {
      this._minScale = relativeHeight / props.imageHeight > relativeWidth / props.imageWidth ?
        relativeWidth / props.imageWidth :
        relativeHeight / props.imageHeight;
    }
    this._scale = this._minScale;
    this.state = {
      scale: new Animated.Value(this._scale),
      pan: new Animated.ValueXY(),
      angle: new Animated.Value('0deg'),
      animating: false,
      render: false,
    };
    // ref of the surface to capture
    this.surface = null;
    // ref of view to capture
    this.viewRef = null;
    // panning variables
    this.panListener = null;
    this.currentPanValue = { x: 0, y: 0 };
    this._pan = { x: 0, y: 0 };
    // scaling variables
    this.scaleListener = null;
    this.currentScaleValue = 1;
    // angle variables
    this.angleListener = null;
    this.currentAngleValue = 0;
    this._angle = 0;
    // used for multiTouch
    this._previousDistance = 0;
    this._previousAngle = 0;
    this._previousCenter = 0;
    this._multiTouch = false;
    // used for callbacks
    this._onPress = null;
    this._onLongPress = null;
    this._totalMovedX = 0;
    this._totalMovedY = 0;
    this._onLongPressSuccess = false;
    this._onMoveCallbackSucess = false;

    // methods
    this._handlePanResponderGrant = this._handlePanResponderGrant.bind(this);
    this._handlePanResponderMove = this._handlePanResponderMove.bind(this);
    this._handlePanResponderEnd = this._handlePanResponderEnd.bind(this);
    this._updatePosition = this._updatePosition.bind(this);
    this._updateSize = this._updateSize.bind(this);
    this._checkAdjustment = this._checkAdjustment.bind(this);
    this._updatePanState = this._updatePanState.bind(this);
    this.getScaledDims = this.getScaledDims.bind(this);
    this.captureFrameAndCrop = this.captureFrameAndCrop.bind(this);
    this.getCurrentState = this.getCurrentState.bind(this);
    // the PanResponder
    this._panResponder = PanResponder.create({
      onStartShouldSetPanResponder: (e, g) => !this.state.animating && this.props.panning,
      onMoveShouldSetPanResponder: (e, g) => !this.state.animating && this.props.panning,
      onPanResponderGrant: this._handlePanResponderGrant,
      onPanResponderMove: this._handlePanResponderMove,
      onPanResponderRelease: this._handlePanResponderEnd,
      onPanResponderTerminate: this._handlePanResponderEnd,
    });
  }

  componentDidMount() {
    const { initialPan, initialScale, croppingRequired, onLoad } = this.props;
    this.panListener = this.state.pan.addListener(value => this.currentPanValue = value);
    this.scaleListener = this.state.scale.addListener(value => this.currentScaleValue = value);
    this.angleListener = this.state.angle.addListener(value => this.currentAngleValue = value);
    if (initialScale) {
      this._updateSize(initialScale, initialPan);
    } else {
      this._checkAdjustment();
    }
    if (!croppingRequired && typeof onLoad === 'function') {
      onLoad();
    }
  }

  componentDidUpdate(prevProps) {
    const {
      imageHeight,
      imageWidth,
      imageContainerWidth,
      imageContainerHeight,
      requiresMinScale,
      initialRotate
    } = this.props;
    const {
      imageHeight: prevImageHeight,
      imageWidth: prevImageWidth,
      imageContainerWidth: prevImageContainerWidth,
      imageContainerHeight: prevImageContainerHeight,
      requiresMinScale: prevRequiresMinScale,
      initialRotate: prevInitialRotate,
    } = prevProps;
    if (
      imageHeight !== prevImageHeight ||
      imageWidth !== prevImageWidth ||
      imageContainerWidth !== prevImageContainerWidth ||
      imageContainerHeight !== prevImageContainerHeight ||
      initialRotate !== prevInitialRotate
    ) {
      const relativeWidth = this.props.bigContainerWidth || this.props.imageContainerWidth;
      const relativeHeight = this.props.bigContainerHeight || this.props.imageContainerHeight;
      if (requiresMinScale) {
        this._minScale = relativeHeight / this.props.imageHeight < relativeWidth / this.props.imageWidth ?
          relativeWidth / this.props.imageWidth :
          relativeHeight / this.props.imageHeight;
          this._updateSize(this._minScale, false);
      } else  {
        this._minScale = relativeHeight / this.props.imageHeight > relativeWidth / this.props.imageWidth ?
          relativeWidth / this.props.imageWidth :
          relativeHeight / this.props.imageHeight;
          this._updateSize(this._minScale, false);
      }
      this._checkAdjustment(this._minScale);
    }
  }

  componentWillUnmount() {
    this.state.pan.removeListener(this.panListener);
    this.state.scale.removeListener(this.scaleListener);
    this.state.angle.removeListener(this.angleListener);
    if (this._onPress) {
      clearTimeout(this._onPress);
    }
    if (this._onLongPress) {
      clearTimeout(this._onLongPress);
    }
  }

  _updatePosition(x, y) {
    this.setState({ animating: true }, () => {
      Animated.timing(
        this.state.pan, {
          toValue: { x, y },
          easing: Easing.elastic(1),
          duration: 250
        }
      ).start(() => this._updatePanState());
    });
  }

  _updateSize(scale, initialPan = false) {
    this.setState({ animating: true }, () => {
      Animated.timing(
        this.state.scale, {
          toValue: scale,
          easing: Easing.elastic(1),
          duration: 250
        }
      ).start(() => {
        this.setState({ animating: false });
        this._scale = this.currentScaleValue.value;
        if (initialPan) {
          const { showAtTop, imageHeight } = this.props;
          const pan = Object.assign({}, initialPan);
          if (showAtTop) {
            const additionalHeight = (imageHeight - this._scale * imageHeight) / 2;
            pan.y = -additionalHeight;
          }
          this._updatePosition(pan.x, pan.y);
        }
      });
    });
  }

  _updatePanState(x = this.currentPanValue.x, y = this.currentPanValue.y) {
    this.state.pan.setOffset({ x, y });
    this.state.pan.setValue({ x: 0, y: 0 });
    this.setState({ animating: false, render: true });
  }

  _handlePanResponderGrant(e, gestureState) {
    const { onPressCallback, onLongPressCallback } = this.props;
    if (onPressCallback) {
      this._onPress = setTimeout(() => {
        clearTimeout(this._onPress);
        this._onPress = null;
      }, 200);
    }
    if (onLongPressCallback) {
      this._onLongPress = setTimeout(() => {
        clearTimeout(this._onLongPress);
        this._onLongPress = null;
      }, 500);
    }
  }

  _handlePanResponderMove(e, gestureState) {
    const { imageContainerWidth, imageWidth, imageHeight, onLongPressCallback, onMoveCallback } = this.props;
    if (gestureState.numberActiveTouches === 1 && !this._multiTouch) {
      this._totalMovedX += Math.abs(gestureState.dx);
      this._totalMovedY += Math.abs(gestureState.dy);
      if (
        !this._onLongPress && onLongPressCallback &&
        (this._totalMovedX < 50 && this._totalMovedY < 50) &&
        !this._onLongPressSuccess
      ) {
        this._onLongPressSuccess = true;
        return onLongPressCallback();
      } else if (onMoveCallback && !this._onMoveCallbackSucess) {
        this._onMoveCallbackSucess = true;
        onMoveCallback();
      }
      return Animated.event([
        null, { dx: this.state.pan.x, dy: this.state.pan.y }
      ])(e, gestureState);
    } else if (gestureState.numberActiveTouches !== 1) {
      if (onMoveCallback && !this._onMoveCallbackSucess) {
        this._onMoveCallbackSucess = true;
        onMoveCallback();
      }
      this._multiTouch = true;
      // set the intial values
      this._previousDistance = this._previousDistance === 0 ?
        distance(e.nativeEvent.touches) : this._previousDistance;
      this._previousAngle = this._previousAngle === 0 ?
        angle(e.nativeEvent.touches) : this._previousAngle;
      this._previousCenter = this._previousCenter === 0 ?
        center(e.nativeEvent.touches) : this._previousCenter;
      // angle calculations
      const angleChange = angle(e.nativeEvent.touches) - this._previousAngle;
      this.state.angle.setValue(
        `${parseFloat(this._angle) + angleChange}deg`
      );
      // zoom calculations
      const currentDistance = distance(e.nativeEvent.touches);
      const newScale = ((currentDistance - this._previousDistance + imageContainerWidth) / imageContainerWidth) * this._scale;
      this.state.scale.setValue(newScale);
      // zoom to the center of the touches
      // const currentCenter = center(e.nativeEvent.touches);
      // const newWidth = newScale * imageWidth;
      // const newHeight = newScale * imageHeight;
      // const currentX = this._pan.x > 0 || newWidth < imageWidth ?
      //   0 : this._pan.x;
      // const currentY = this._pan.y > 0 || newHeight < imageHeight ?
      //   0 : this._pan.y;
      // console.log('pan', this._pan);
      // const x = currentCenter.x - this._previousCenter.x + currentX;
      // const y = currentCenter.y - this._previousCenter.y + currentY;
      // this.state.pan.setOffset({ x, y });
      // return Animated.event([
      //   null, { dx: this.state.pan.x, dy: this.state.pan.y }
      // ])(e, gestureState);
    }
  }

  _handlePanResponderEnd() {
    if (this._onPress && (
      (this._totalMovedX < 30 && this._totalMovedY < 30)
    )) {
      clearTimeout(this._onPress);
      this._onPress = null;
      this.props.onPressCallback();
    }
    if (this._onLongPress) {
      clearTimeout(this._onLongPress);
      this.onLongPress = null;
    }
    if (this._onLongPressSuccess) {
      this._onLongPressSuccess = false;
      if (this.props.onLongPressReleaseCallback) {
        this.props.onLongPressReleaseCallback();
      }
    }
    if (this._onMoveCallbackSucess) {
      this._onMoveCallbackSucess = false;
      if (this.props.onEndCallback) {
        this.props.onEndCallback();
      }
    }
    this._onMoveCallbackSucess = false;
    this._totalMovedX = 0;
    this._totalMovedY = 0;
    const { imageWidth, imageHeight, imageContainerWidth, imageContainerHeight } = this.props;
    this._pan = this.currentPanValue;
    this._updatePanState();
    if (this._multiTouch) {
      this._scale = this.currentScaleValue.value;
      this._angle = this.currentAngleValue.value;
      this._multiTouch = false;
      this._previousDistance = 0;
      this._previousAngle = 0;
      this._previousCenter = 0;
      const { maskWidth, maskHeight } = this.props;
      if (this._minScale > this._scale) {
        this._updateSize(this._minScale);
      } else if (this._scale > 1) {
        this._updateSize(this._scale);
      }
    }
    this._checkAdjustment();
  }

  _checkAdjustment(withScale = this._scale) {
    const { imageContainerHeight, imageContainerWidth, maskPadding, imageHeight, imageWidth, center, initialRotate } = this.props;
    const widthDiff = withScale * imageWidth - imageContainerWidth;
    const heightDiff = withScale * imageHeight - imageContainerHeight;
    const maskPaddingDiffX = widthDiff < 0 && center ? -widthDiff / 2 : maskPadding;
    const maskPaddingDiffY = heightDiff < 0 && center ? -heightDiff / 2 : maskPadding;
    const positionUpdate = { x: 0, y: 0 };
    const imageLeft = this.currentPanValue.x + widthDiff + maskPaddingDiffX;
    const imageAbove = this.currentPanValue.y + heightDiff + maskPaddingDiffY;
    const additionalWidth = (imageWidth - withScale * imageWidth) / 2;
    const additionalHeight = (imageHeight - withScale * imageHeight) / 2;
    if (this.currentPanValue.x > maskPaddingDiffX - additionalWidth) {
      positionUpdate.x = -this.currentPanValue.x - additionalWidth + maskPaddingDiffX;
    }
    if (this.currentPanValue.y > maskPaddingDiffY - additionalHeight) {
      positionUpdate.y = -this.currentPanValue.y - additionalHeight + maskPaddingDiffY;
    }
    if (imageAbove < -additionalHeight) {
      positionUpdate.y = -imageAbove - additionalHeight;
    }
    if (imageLeft < -additionalWidth) {
      positionUpdate.x = -imageLeft - additionalWidth;
    }
    this._updatePosition(positionUpdate.x, positionUpdate.y);
  }

  getScaledDims() {
    return {
      top: this._scale * this.props.imageHeight + this.currentPanValue.y,
      left: this._scale * this.props.imageWidth + this.currentPanValue.x,
    };
  }

  getPanAndScale() {
    return {
      pan: this.currentPanValue,
      scale: this._scale,
    };
  }

  captureFrameAndCrop(captureProperties) {
    const properties = this.getCurrentState(captureProperties);
    const cropImage = (image) => new Promise(resolve =>
      ImageEditor.cropImage(image, properties, uri => resolve(uri), () => null)
    );
    const { croppingRequired, useCustomContent, imageWidth, imageHeight } = this.props;

    const getSize = (url) => new Promise((resolve, reject) =>
      Image.getSize(url,
        (imgWidth, imgHeight) => resolve({ width: imgWidth, height: imgHeight, url }),
        (err) => reject(err))
    );
    if (useCustomContent && !croppingRequired) {
      properties.offset.x *= 2;
      properties.offset.y *= 2;
      properties.size.width *= 2;
      properties.size.height *= 2;
      return takeSnapshot(this.viewRef, {
        quality: 1,
        result: 'file',
        format: 'jpg',       
        width: undefined,
        height: undefined
      })
        .then(url => getSize(url))
        .then(image => {
          // because of takeSnapshot resizes image size
          properties.size.height *= image.height / imageHeight;
          properties.size.width *= image.width / imageWidth;
          return cropImage(image.url);
        })
        .then(uri => uri)
        .catch(err => console.log(err));
    }

    return this.surface.captureFrame({
      quality: 1,
      format: 'file',
      type: 'jpg',
      filePath: `${RNFS.DocumentDirectoryPath}/${new Date().getTime()}.jpg`
    })
    .then(image => cropImage(image))
    .then(uri => uri)
    .catch(error => console.log(error));
  }

  getCurrentState({ pan, scale, layout, imageLength }) {
    const {
      imageWidth,
      imageHeight,
      imageContainerWidth,
      imageContainerHeight,
      bigContainerWidth,
      bigContainerHeight,
      initialRotate,
    } = this.props;
    const containerWidth = bigContainerWidth || imageContainerWidth;
    const containerHeight = bigContainerHeight || imageContainerHeight;
    const ogScaleX = (containerWidth / imageWidth);
    const ogScaleY = (containerHeight / imageHeight);
    const scaleChangeX = (scale - ogScaleX) / scale;
    const scaleChangeY = (scale - ogScaleY) / scale;
    const roundWidth = Math.floor(scale * imageWidth < containerWidth
      ? imageWidth
      : containerWidth / scale);
    const roundHeight = Math.floor(scale * imageHeight < containerHeight
      ? imageHeight
      : containerHeight / scale);
    const ogPanX = (containerWidth - imageWidth) / 2;
    const ogPanY = (containerHeight - imageHeight) / 2;
    const xZoomOffset = imageWidth * scaleChangeX / 2 - (containerWidth - imageWidth * ogScaleX) < 0
    ? 0
    : imageWidth * scaleChangeX / 2 - (containerWidth - imageWidth * ogScaleX) / 2;
    const yZoomOffset = imageHeight * scaleChangeY / 2 - (containerHeight - imageHeight * ogScaleY) < 0
    ? 0
    : imageHeight * scaleChangeY / 2 - (containerHeight - imageHeight * ogScaleY) / 2;
    const xPanOffset = (ogPanX - pan.x) / scale;
    const yPanOffset = (ogPanY - pan.y) / scale;

    // amount image top left corner has moved from zooming
    const zoomOffset = {
      x: xZoomOffset,
      y: yZoomOffset,
    };

    // amount image top left corner has moved from panning
    const panOffset = {
      x: xPanOffset,
      y: yPanOffset
    };

    // total offset of top left corner from original state.
    const offset = {
      x: zoomOffset.x + panOffset.x,
      y: zoomOffset.y + panOffset.y
    };

    return {
      offset,
      size: {
        width: roundWidth,
        height: roundHeight,
      },
    };
  }

  render() {
    const { pan, scale, render } = this.state;
    const {
      imageWidth,
      imageHeight,
      imageMask,
      children,
      rotate,
      style,
      initialRotate,
      croppingRequired,
      imageMaskShown,
      onLoad,
      useCustomContent
    } = this.props;

    const layout = pan.getLayout();
    const animatedStyle = {
      transform: [
        { translateX: layout.left },
        { translateY: layout.top },
        { scale },
      ]
    };

    if (initialRotate) {
      animatedStyle.transform.push({ rotate: initialRotate });
    } else if (rotate) {
      animatedStyle.transform.push({ rotate: this.state.angle });
    }

    const wrapStyle = [
      style,
      styles.container,
    ];

    if (!render) {
      return null;
    }

    if (croppingRequired) {
      return (
        <View>
          <AnimatedSurface
            ref={ref => this.surface = ref}
            width={imageWidth}
            height={imageHeight}
            style={animatedStyle}
            pixelRatio={1}
            visibleContent={true}
            onLoad={onLoad}
            preload={true}
            {...this._panResponder.panHandlers}
          >
            {children}
          </AnimatedSurface>
          {imageMaskShown && imageMask}
        </View>
      );
    }
    if (useCustomContent) {
      const { style: contentStyle } = children.props;
      return (
        <View
          style={wrapStyle}
          {...this._panResponder.panHandlers}
        >
          {cloneElement(children, {
            style: [animatedStyle, contentStyle],
            ref: (ref) => this.viewRef = ref,
          })}
          {imageMaskShown && imageMask}
        </View>
      );
    }

    return (
      <View style={wrapStyle} {...this._panResponder.panHandlers}>
        <Animated.View style={animatedStyle}>
          {children}
        </Animated.View>
        {imageMaskShown && imageMask}
      </View>
    );
  }
}
