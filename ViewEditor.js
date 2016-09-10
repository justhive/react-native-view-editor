import React, { Component, PropTypes } from 'react';
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
import { Surface, AnimatedSurface } from 'gl-react-native';
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
    // used for multi-images
    bigContainerWidth: PropTypes.number,
    bigContainerHeight: PropTypes.number,
    requiresMinScale: PropTypes.bool,
    initialScale: PropTypes.number,
    initialPan: PropTypes.object,
  }

  static defaultProps = {
    maskWidth: width,
    maskHeight: height,
    maskPadding: 0,
    imageContainerWidth: width,
    imageContainerHeight: height,
    center: true,
    rotate: false,
    panning: true,
    croppingRequired: false,
    requiresMinScale: false,
    initialScale: null,
    initialPan: null,
  }

  constructor(props, context) {
    super(props, context);
    const relativeWidth = props.bigContainerWidth || props.imageContainerWidth;
    const relativeHeight = props.bigContainerHeight || props.imageContainerHeight;
    if (props.requiresMinScale) {
      this._minScale = relativeHeight / props.imageHeight < relativeWidth / props.imageWidth ? relativeWidth / props.imageWidth : relativeHeight / props.imageHeight;
    } else {
      this._minScale = relativeHeight / props.imageHeight > relativeWidth / props.imageWidth ? relativeWidth / props.imageWidth : relativeHeight / props.imageHeight;
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

    // methods
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
      onStartShouldSetPanResponder: () => !this.state.animating && this.props.panning,
      onMoveShouldSetPanResponder: () => !this.state.animating && this.props.panning,
      onPanResponderMove: this._handlePanResponderMove,
      onPanResponderRelease: this._handlePanResponderEnd,
      onPanResponderTerminate: this._handlePanResponderEnd,
    });
  }

  componentDidMount() {
    const { initialPan, initialScale } = this.props;
    this.panListener = this.state.pan.addListener(value => this.currentPanValue = value);
    this.scaleListener = this.state.scale.addListener(value => this.currentScaleValue = value);
    this.angleListener = this.state.angle.addListener(value => this.currentAngleValue = value);
    if (initialScale) {
      this._updateSize(initialScale, initialPan);
    } else {
      this._checkAdjustment();
    }
  }

  componentDidUpdate(prevProps) {
    const {
      imageHeight,
      imageWidth,
      imageContainerWidth,
      imageContainerHeight,
    } = this.props;
    const {
      imageHeight: prevImageHeight,
      imageWidth: prevImageWidth,
      imageContainerWidth: prevImageContainerWidth,
      imageContainerHeight: prevImageContainerHeight,
    } = prevProps;
    if (
      imageHeight !== prevImageHeight ||
      imageWidth !== prevImageWidth ||
      imageContainerWidth !== prevImageContainerWidth ||
      imageContainerHeight !== prevImageContainerHeight
    ) {
      this._checkAdjustment();
    }
  }

  componentWillUnmount() {
    this.state.pan.removeListener(this.panListener);
    this.state.scale.removeListener(this.scaleListener);
    this.state.angle.removeListener(this.angleListener);
  }

  _updatePosition(x, y) {
    this.setState({ animating: true }, () => {
      Animated.timing(
        this.state.pan, {
          toValue: { x, y },
          easing: Easing.elastic(1),
          duration: 250
        }
      ).start(() => this._updatePanState())
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
          this._updatePosition(initialPan.x, initialPan.y)
        }
      });
    });
  }

  _updatePanState(x = this.currentPanValue.x, y = this.currentPanValue.y) {
    this.state.pan.setOffset({ x, y });
    this.state.pan.setValue({ x: 0, y: 0 });
    this.setState({ animating: false, render: true });
  }

  _handlePanResponderMove(e, gestureState) {
    const { imageContainerWidth, imageWidth, imageHeight } = this.props;
    if (gestureState.numberActiveTouches === 1 && !this._multiTouch) {
      return Animated.event([
        null, { dx: this.state.pan.x, dy: this.state.pan.y }
      ])(e, gestureState);
    } else if (gestureState.numberActiveTouches !== 1) {
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
        this._updateSize(1)
      } else {
        this._checkAdjustment();
      }
    } else {
      this._checkAdjustment();
    }
  }

  _checkAdjustment() {
    const { imageContainerHeight, imageContainerWidth, maskPadding, imageHeight, imageWidth, center } = this.props;
    const widthDiff = this._scale * imageWidth - imageContainerWidth;
    const heightDiff = this._scale * imageHeight - imageContainerHeight;
    const maskPaddingDiffX = widthDiff < 0 && center ? -widthDiff / 2 : maskPadding;
    const maskPaddingDiffY = heightDiff < 0 && center ? -heightDiff / 2 : maskPadding;
    const positionUpdate = { x: 0, y: 0 };
    const imageLeft = this.currentPanValue.x + widthDiff + maskPaddingDiffX;
    const imageAbove = this.currentPanValue.y + heightDiff + maskPaddingDiffY;
    const additionalWidth = (imageWidth - this._scale * imageWidth) / 2;
    const additionalHeight = (imageHeight - this._scale * imageHeight) / 2;
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

  captureFrameAndCrop(captureProperties = null) {
    const properties = captureProperties || this.getCurrentState();
    const cropImage = (image) => new Promise(resolve =>
      ImageEditor.cropImage(image, properties, uri => resolve(uri), () => null)
    );
    return this.surface.captureFrame({ quality: 1, format: 'file', type: 'jpg', filePath: `${RNFS.DocumentDirectoryPath}/${new Date().getTime()}.jpg`})
    .then(image => cropImage(image))
    .then(uri => uri)
    .catch(error => console.log(error));
  }

  getCurrentState() {
    const {
      imageWidth,
      imageHeight,
      imageContainerWidth,
      imageContainerHeight,
    } = this.props;
    const subWidth = this._scale * imageWidth < imageContainerWidth ? (imageContainerWidth - this._scale * imageWidth) / 2 : 0;
    const subHeight = this._scale * imageHeight < imageContainerHeight ? (imageContainerHeight - this._scale * imageHeight) / 2 : 0;
    const roundWidth = Math.floor(this._scale * imageWidth < imageContainerWidth ? imageWidth : imageWidth - (this._scale - imageContainerWidth / imageWidth) * imageWidth);
    const roundHeight = Math.floor(this._scale * imageHeight < imageContainerHeight ? imageHeight : imageHeight - (this._scale - imageContainerHeight / imageHeight) * imageHeight);
    return {
      offset: {
        x: (imageWidth - this._scale * imageWidth) / 2 + this.currentPanValue.x - subWidth,
        y: (imageHeight - this._scale * imageHeight) / 2 + this.currentPanValue.y - subHeight,
      },
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
      imageContainerWidth,
      imageContainerHeight,
      imageMask,
      children,
      rotate,
      style,
      croppingRequired,
    } = this.props;
    const layout = pan.getLayout();
    const animatedStyle = {
      transform: [
        { translateX: layout.left },
        { translateY: layout.top },
        { scale }
      ]
    };
    if (rotate) {
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
        <AnimatedSurface
          ref={ref => this.surface = ref}
          width={imageWidth}
          height={imageHeight}
          style={animatedStyle}
          pixelRatio={1}
          {...this._panResponder.panHandlers}
        >
          {children}
        </AnimatedSurface>
      );
    }

    return (
      <View style={wrapStyle} {...this._panResponder.panHandlers}>
        <Animated.View style={animatedStyle}>
          {children()}
        </Animated.View>
        {imageMask && React.createElement(imageMask)}
      </View>
    );
  }
}
